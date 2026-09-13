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

  it('aggregates votes safely and keeps a current results snapshot', () => {
    const { room, user } = success(rooms.create('one', 'Alice', ['__proto__']));
    success(rooms.join(room.code, 'two', 'Bobby'));
    success(rooms.castVote(room.code, user.id, '__proto__'));
    success(rooms.castVote(room.code, 'two', '__proto__'));
    expect(rooms.revealResults(room.code, 'two')).toMatchObject({
      error: { event: 'user-not-mod' },
    });
    const revealed = success(rooms.revealResults(room.code, user.id));
    expect(Object.entries(revealed.results)).toEqual([['__proto__', 2]]);
    expect(
      revealed.users.every((participant) => participant.vote === '__proto__'),
    ).toBe(true);
    expect(
      room.users.every((participant) => participant.vote === '__proto__'),
    ).toBe(true);
    expect(room.state).toBe('results');
    const snapshot = rooms.toJoinedRoom(room, user);
    expect(snapshot.state).toBe('results');
    expect(Object.entries(snapshot.results)).toEqual([['__proto__', 2]]);
    expect(snapshot.users.map((participant) => participant.vote)).toEqual([
      '__proto__',
      '__proto__',
    ]);
    expect(rooms.startVoting(room.code, 'two')).toMatchObject({
      error: { event: 'user-not-mod' },
    });
    success(rooms.startVoting(room.code, user.id));
    expect(room.state).toBe('voting');
    expect(room.results).toEqual({});
    expect(room.users.every((participant) => participant.vote === null)).toBe(
      true,
    );
  });

  it('only accepts cards in the room set and lets a user remove a vote', () => {
    const { room, user } = success(rooms.create('one', 'Alice', ['1', '2']));
    expect(rooms.castVote(room.code, user.id, '3')).toEqual({
      error: { event: 'invalid-vote', data: null },
    });
    success(rooms.castVote(room.code, user.id, '2'));
    expect(user.vote).toBe('2');
    success(rooms.castVote(room.code, user.id, null));
    expect(user.vote).toBeNull();
    success(rooms.revealResults(room.code, user.id));
    expect(rooms.castVote(room.code, user.id, '1')).toEqual({
      error: { event: 'voting-not-active', data: null },
    });
  });

  it('protects rooms with a password without exposing that password', () => {
    const { room, user } = success(
      rooms.create('one', 'Alice', undefined, 'secret'),
    );
    expect(rooms.join(room.code, 'two', 'Bobby')).toEqual({
      error: { event: 'wrong-room-password', data: null },
    });
    expect(rooms.join(room.code, 'two', 'Bobby', 'wrong')).toEqual({
      error: { event: 'wrong-room-password', data: null },
    });
    success(rooms.join(room.code, 'two', 'Bobby', 'secret'));
    const snapshot = rooms.toJoinedRoom(room, user);
    expect(snapshot.requiresPassword).toBe(true);
    expect(snapshot).not.toHaveProperty('password');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('lets moderators promote and remove users and lets users change avatars', () => {
    const { room, user: owner } = success(rooms.create('one', 'Alice'));
    const { user: guest } = success(rooms.join(room.code, 'two', 'Bobby'));
    expect(rooms.promoteUser(room.code, guest.id, guest.id)).toEqual({
      error: { event: 'user-not-mod', data: null },
    });
    success(rooms.promoteUser(room.code, owner.id, guest.id));
    expect(guest.role).toBe('mod');
    expect(rooms.kickUser(room.code, guest.id, guest.id)).toEqual({
      error: { event: 'cannot-kick-self', data: null },
    });
    expect(rooms.changeAvatar(room.code, guest.id, -1)).toEqual({
      error: { event: 'invalid-avatar', data: null },
    });
    success(rooms.changeAvatar(room.code, guest.id, 4));
    expect(guest.avatar).toBe(4);
    success(rooms.kickUser(room.code, owner.id, guest.id));
    expect(room.users).toEqual([owner]);
    expect(rooms.reconnect(guest.token, room.code)).toEqual({
      error: { event: 'room-not-found', data: null },
    });
  });

  it('returns empty results for a round without votes', () => {
    const { room, user } = success(rooms.create('one', 'Alice'));
    expect(success(rooms.revealResults(room.code, user.id)).results).toEqual(
      {},
    );
  });
});
