import { beforeEach, describe, expect, it } from 'vitest';
import { RoomService } from './room.service.js';
import { UserService } from './user.service.js';
import type { RoomResult } from './events.types.js';

function success<T>(result: RoomResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(JSON.stringify(result.error));
  return result as T;
}

let rooms: RoomService;
beforeEach(() => {
  rooms = new RoomService(new UserService());
});

describe('RoomService', () => {
  it('does not share mutable card sets between rooms or with callers', () => {
    const first = success(rooms.create('one', 'Alice'));
    const second = success(rooms.create('two', 'Bobby', []));
    first.room.cardSet.push('extra');
    expect(second.room.cardSet).not.toContain('extra');
    const cards = ['yes', 'no'];
    const custom = success(rooms.create('three', 'Carol', cards));
    cards.push('maybe');
    expect(custom.room.cardSet).toEqual(['yes', 'no']);
  });

  it('keeps disconnected names reserved and restores membership by token', () => {
    const { room, user } = success(rooms.create('one', 'Alice'));
    expect(rooms.disconnect(room.code, user.id)?.user.status).toBe(
      'disconnected',
    );
    expect(rooms.join(room.code, 'two', 'Alice')).toEqual({
      error: { event: 'name-taken', data: null },
    });
    expect(success(rooms.reconnect(user.token)).user.status).toBe('connected');
    expect(room.users).toHaveLength(1);
    expect(rooms.disconnect(room.code, 'unknown')).toBeUndefined();
    expect(rooms.disconnect('missing', user.id)).toBeUndefined();
  });

  it('rejects invalid joins without mutating membership', () => {
    const { room } = success(rooms.create('one', 'Alice'));
    expect(rooms.join(room.code, 'two', 'ab')).toMatchObject({
      error: { event: 'bad-username' },
    });
    expect(room.users).toHaveLength(1);
  });

  it('aggregates votes safely, snapshots results and resets for another round', () => {
    const { room, user } = success(rooms.create('one', 'Alice'));
    success(rooms.join(room.code, 'two', 'Bobby'));
    success(rooms.castVote(room.code, user.id, '__proto__'));
    success(rooms.castVote(room.code, 'two', '__proto__'));
    expect(rooms.revealResults(room.code, 'two')).toMatchObject({
      error: { event: 'user-not-mod' },
    });
    expect(user.vote).toBe('__proto__');
    const revealed = success(rooms.revealResults(room.code, user.id));
    expect(Object.entries(revealed.results)).toEqual([['__proto__', 2]]);
    expect(revealed.users.every((user) => user.vote === '__proto__')).toBe(
      true,
    );
    expect(room.users.every((user) => user.vote === null)).toBe(true);
    expect(room.state).toBe('results');
    success(rooms.startVoting(room.code, 'two'));
    expect(room.state).toBe('voting');
    expect(revealed.users[0].vote).toBe('__proto__');
  });

  it('returns empty results for a round without votes', () => {
    const { room, user } = success(rooms.create('one', 'Alice'));
    expect(success(rooms.revealResults(room.code, user.id)).results).toEqual(
      {},
    );
  });
});
