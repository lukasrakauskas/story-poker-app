import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ROOM_RETENTION_MS,
  OFFLINE_USER_RETENTION_MS,
  RoomService,
} from './room.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomAccessService } from '../collaboration/room-access.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { UserService } from './user.service.js';
import type { RoomResult } from './events.types.js';

function success<T>(result: RoomResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(JSON.stringify(result.error));
  return result as T;
}

let rooms: RoomService;
beforeEach(() => {
  const participants = new ParticipantService();
  rooms = new RoomService(
    new UserService(participants),
    participants,
    new RoomRegistryService(),
    new RetentionService(),
    new RoomAccessService(),
  );
});
afterEach(() => rooms.onModuleDestroy());

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
    expect(rooms.disconnect(room.code, user.id)?.user.connected).toBe(false);
    expect(rooms.join(room.code, 'two', 'Alice')).toEqual({
      error: { event: 'name-taken', data: null },
    });
    expect(success(rooms.reconnect(user.token)).user.connected).toBe(true);
    expect(room.users).toHaveLength(1);
    expect(rooms.disconnect(room.code, 'unknown')).toBeUndefined();
    expect(rooms.disconnect('missing', user.id)).toBeUndefined();
  });

  it('rejects invalid joins without mutating membership', () => {
    const { room } = success(rooms.create('one', 'Alice'));
    expect(rooms.join(room.code, 'two', 'ab')).toMatchObject({
      error: { event: 'bad-username' },
    });
    expect(rooms.join(room.code, 'two', '   ')).toMatchObject({
      error: { event: 'bad-username' },
    });
    expect(room.users).toHaveLength(1);
  });

  it('stores normalized names and reserves the normalized form', () => {
    const { room, user } = success(rooms.create('one', '  Alice  '));
    expect(user.name).toBe('Alice');
    expect(rooms.join(room.code, 'two', ' Alice ')).toEqual({
      error: { event: 'name-taken', data: null },
    });
    expect(success(rooms.join(room.code, 'two', '  Bobby  ')).user.name).toBe(
      'Bobby',
    );
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

  it('excludes offline votes unless the participant reconnects before reveal', () => {
    const { room, user: owner } = success(rooms.create('one', 'Alice'));
    const { user: guest } = success(rooms.join(room.code, 'two', 'Bobby'));
    success(rooms.castVote(room.code, owner.id, '3'));
    success(rooms.castVote(room.code, guest.id, '5'));
    rooms.disconnect(room.code, guest.id);

    expect(success(rooms.revealResults(room.code, owner.id)).results).toEqual({
      '3': 1,
    });

    success(rooms.startVoting(room.code, owner.id));
    success(rooms.reconnect(guest.token, room.code));
    success(rooms.castVote(room.code, owner.id, '3'));
    success(rooms.castVote(room.code, guest.id, '5'));
    rooms.disconnect(room.code, guest.id);
    success(rooms.reconnect(guest.token, room.code));
    expect(success(rooms.revealResults(room.code, owner.id)).results).toEqual({
      '3': 1,
      '5': 1,
    });
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
    expect(room).not.toHaveProperty('password');
    expect(JSON.stringify(room)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('lets moderators promote and remove users and lets users change avatars', () => {
    const { room, user: owner } = success(rooms.create('one', 'Alice'));
    const { user: guest } = success(rooms.join(room.code, 'two', 'Bobby'));
    expect(rooms.promoteUser(room.code, guest.id, guest.id)).toEqual({
      error: { event: 'user-not-mod', data: null },
    });
    success(rooms.promoteUser(room.code, owner.id, guest.id));
    expect(guest.role).toBe('moderator');
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

  it('lets a user claim the role only when all moderators are offline', () => {
    const { room, user: owner } = success(rooms.create('one', 'Alice'));
    const { user: moderator } = success(rooms.join(room.code, 'two', 'Bobby'));
    const { user: claimant } = success(rooms.join(room.code, 'three', 'Carol'));
    success(rooms.promoteUser(room.code, owner.id, moderator.id));

    expect(rooms.claimModerator(room.code, claimant.id)).toEqual({
      error: { event: 'moderator-online', data: null },
    });
    rooms.disconnect(room.code, owner.id);
    expect(rooms.claimModerator(room.code, claimant.id)).toEqual({
      error: { event: 'moderator-online', data: null },
    });
    rooms.disconnect(room.code, moderator.id);
    expect(success(rooms.claimModerator(room.code, claimant.id)).user).toBe(
      claimant,
    );
    expect(claimant.role).toBe('moderator');
    expect(success(rooms.claimModerator(room.code, claimant.id)).user).toBe(
      claimant,
    );
  });

  it('returns empty results for a round without votes', () => {
    const { room, user } = success(rooms.create('one', 'Alice'));
    expect(success(rooms.revealResults(room.code, user.id)).results).toEqual(
      {},
    );
  });

  it('expires an empty room after the reconnect retention period', () => {
    vi.useFakeTimers();
    try {
      const { room, user } = success(rooms.create('one', 'Alice'));
      rooms.disconnect(room.code, user.id);

      vi.advanceTimersByTime(EMPTY_ROOM_RETENTION_MS - 1);
      expect(rooms.get(room.code)).toBe(room);
      vi.advanceTimersByTime(1);
      expect(rooms.get(room.code)).toBeUndefined();
      expect(rooms.join(room.code, 'two', 'Bobby')).toEqual({
        error: { event: 'room-not-found', data: null },
      });
      expect(rooms.reconnect(user.token, room.code)).toEqual({
        error: { event: 'room-not-found', data: null },
      });
    } finally {
      rooms.onModuleDestroy();
      vi.useRealTimers();
    }
  });

  it('postpones expiration after reconnecting and clears timers on shutdown', () => {
    vi.useFakeTimers();
    try {
      const { room, user } = success(rooms.create('one', 'Alice'));
      rooms.disconnect(room.code, user.id);
      vi.advanceTimersByTime(OFFLINE_USER_RETENTION_MS / 2);
      success(rooms.reconnect(user.token, room.code));
      vi.advanceTimersByTime(EMPTY_ROOM_RETENTION_MS);
      expect(rooms.get(room.code)).toBe(room);

      rooms.disconnect(room.code, user.id);
      expect(vi.getTimerCount()).toBe(2);
      rooms.onModuleDestroy();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(EMPTY_ROOM_RETENTION_MS);
      expect(rooms.get(room.code)).toBe(room);
    } finally {
      rooms.onModuleDestroy();
      vi.useRealTimers();
    }
  });

  it('removes an offline user from an active room and releases the name', () => {
    vi.useFakeTimers();
    try {
      const expired = vi.fn();
      rooms.onUserExpired(expired);
      const { room, user: owner } = success(rooms.create('one', 'Alice'));
      const { user: guest } = success(rooms.join(room.code, 'two', 'Bobby'));

      rooms.disconnect(room.code, guest.id);
      vi.advanceTimersByTime(OFFLINE_USER_RETENTION_MS - 1);
      expect(room.users).toContain(guest);
      vi.advanceTimersByTime(1);
      expect(room.users).toEqual([owner]);
      expect(expired).toHaveBeenCalledWith(room, guest);
      expect(success(rooms.join(room.code, 'three', 'Bobby')).user.name).toBe(
        'Bobby',
      );
    } finally {
      rooms.onModuleDestroy();
      vi.useRealTimers();
    }
  });

  it('keeps an offline user when they reconnect before user expiration', () => {
    vi.useFakeTimers();
    try {
      const expired = vi.fn();
      rooms.onUserExpired(expired);
      const { room } = success(rooms.create('one', 'Alice'));
      const { user: guest } = success(rooms.join(room.code, 'two', 'Bobby'));

      rooms.disconnect(room.code, guest.id);
      vi.advanceTimersByTime(OFFLINE_USER_RETENTION_MS - 1);
      success(rooms.reconnect(guest.token, room.code));
      vi.advanceTimersByTime(OFFLINE_USER_RETENTION_MS);
      expect(room.users).toContain(guest);
      expect(guest.connected).toBe(true);
      expect(expired).not.toHaveBeenCalled();
    } finally {
      rooms.onModuleDestroy();
      vi.useRealTimers();
    }
  });
});
