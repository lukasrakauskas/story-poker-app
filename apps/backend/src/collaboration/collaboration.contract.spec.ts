import { describe, expect, it } from 'vitest';
import type { RoomResult } from '../events/events.types.js';
import { RoomService } from '../events/room.service.js';
import { UserService } from '../events/user.service.js';
import { RetroService } from '../retro/retro.service.js';
import { ParticipantService } from './participant.service.js';
import { RetentionService } from './retention.service.js';
import { RoomRegistryService } from './room-registry.service.js';

type Contract = {
  owner: { id: string; token: string };
  guest: { id: string; token: string };
  names: () => string[];
  isModerator: (id: string) => boolean;
  isConnected: (id: string) => boolean;
  disconnectGuest: () => void;
  resumeGuest: () => { id: string; token: string };
  duplicateNameIsRejected: () => boolean;
  close: () => void;
};

function success<T>(result: RoomResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(JSON.stringify(result.error));
  return result as T;
}

const domains: { name: string; setup: () => Contract }[] = [
  {
    name: 'Planning Poker',
    setup: () => {
      const participants = new ParticipantService();
      const rooms = new RoomService(
        new UserService(participants),
        participants,
        new RoomRegistryService(),
        new RetentionService(),
      );
      const { room, user: owner } = success(rooms.create('owner', '  Alice  '));
      const { user: guest } = success(
        rooms.join(room.code, 'guest', '  Bobby  '),
      );
      return {
        owner: { id: owner.id, token: owner.token },
        guest: { id: guest.id, token: guest.token },
        names: () => room.users.map((participant) => participant.name),
        isModerator: (id) =>
          room.users.find((participant) => participant.id === id)?.role ===
          'moderator',
        isConnected: (id) =>
          room.users.find((participant) => participant.id === id)?.connected ??
          false,
        disconnectGuest: () => {
          rooms.disconnect(room.code, guest.id);
        },
        resumeGuest: () => {
          const resumed = success(rooms.reconnect(guest.token, room.code)).user;
          return { id: resumed.id, token: resumed.token };
        },
        duplicateNameIsRejected: () =>
          'error' in rooms.join(room.code, 'duplicate', ' bObBy '),
        close: () => rooms.onModuleDestroy(),
      };
    },
  },
  {
    name: 'Retrospective',
    setup: () => {
      const rooms = new RetroService(
        new ParticipantService(),
        new RoomRegistryService(),
      );
      const owner = rooms.create('  Alice  ', 'Retro');
      const guest = rooms.join(owner.code, '  Bobby  ');
      return {
        owner,
        guest,
        names: () =>
          rooms.snapshot(owner).members.map((participant) => participant.name),
        isModerator: (id) =>
          rooms
            .snapshot(owner)
            .members.find((participant) => participant.id === id)?.moderator ??
          false,
        isConnected: (id) =>
          rooms
            .snapshot(owner)
            .members.find((participant) => participant.id === id)?.connected ??
          false,
        disconnectGuest: () => rooms.disconnect(guest),
        resumeGuest: () => rooms.resume(guest.code, guest.token),
        duplicateNameIsRejected: () => {
          try {
            rooms.join(owner.code, ' bObBy ');
            return false;
          } catch {
            return true;
          }
        },
        close: () => undefined,
      };
    },
  },
];

describe.each(domains)('$name shared collaboration contract', ({ setup }) => {
  it('normalizes unique names and assigns the same role and token guarantees', () => {
    const room = setup();
    try {
      expect(room.names()).toEqual(['Alice', 'Bobby']);
      expect(room.duplicateNameIsRejected()).toBe(true);
      expect(room.owner.token).toHaveLength(32);
      expect(room.guest.token).toHaveLength(32);
      expect(room.guest.token).not.toBe(room.owner.token);
      expect(room.isModerator(room.owner.id)).toBe(true);
      expect(room.isModerator(room.guest.id)).toBe(false);
    } finally {
      room.close();
    }
  });

  it('retains a disconnected identity and restores it with the same token', () => {
    const room = setup();
    try {
      room.disconnectGuest();
      expect(room.isConnected(room.guest.id)).toBe(false);
      expect(room.resumeGuest()).toEqual(room.guest);
      expect(room.isConnected(room.guest.id)).toBe(true);
    } finally {
      room.close();
    }
  });
});
