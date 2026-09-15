import { describe, expect, it } from 'vitest';
import type { RoomResult } from '../events/events.types.js';
import { RoomService } from '../events/room.service.js';
import { UserService } from '../events/user.service.js';
import { InMemoryRetroRoomRepository } from '../retro/retro-room.repository.js';
import { RetroService } from '../retro/retro.service.js';
import { ParticipantService } from './participant.service.js';
import { RetentionService } from './retention.service.js';
import { RoomRegistryService } from './room-registry.service.js';

type Contract = {
  owner: { id: string; token: string };
  guest: { id: string; token: string };
  names: () => Promise<string[]>;
  isModerator: (id: string) => Promise<boolean>;
  isConnected: (id: string) => Promise<boolean>;
  disconnectGuest: () => Promise<void>;
  resumeGuest: () => Promise<{ id: string; token: string }>;
  duplicateNameIsRejected: () => Promise<boolean>;
  close: () => Promise<void>;
};

function success<T>(result: RoomResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(JSON.stringify(result.error));
  return result as T;
}

const domains: { name: string; setup: () => Promise<Contract> }[] = [
  {
    name: 'Planning Poker',
    setup: async () => {
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
        names: async () => room.users.map((participant) => participant.name),
        isModerator: async (id) =>
          room.users.find((participant) => participant.id === id)?.role ===
          'moderator',
        isConnected: async (id) =>
          room.users.find((participant) => participant.id === id)?.connected ??
          false,
        disconnectGuest: async () => {
          rooms.disconnect(room.code, guest.id);
        },
        resumeGuest: async () => {
          const resumed = success(rooms.reconnect(guest.token, room.code)).user;
          return { id: resumed.id, token: resumed.token };
        },
        duplicateNameIsRejected: async () =>
          'error' in rooms.join(room.code, 'duplicate', ' bObBy '),
        close: async () => rooms.onModuleDestroy(),
      };
    },
  },
  {
    name: 'Retrospective',
    setup: async () => {
      const rooms = new RetroService(
        new ParticipantService(),
        new InMemoryRetroRoomRepository(),
      );
      const owner = await rooms.create('  Alice  ', 'Retro');
      const guest = await rooms.join(owner.code, '  Bobby  ');
      return {
        owner,
        guest,
        names: async () =>
          (await rooms.snapshot(owner)).members.map(
            (participant) => participant.name,
          ),
        isModerator: async (id) =>
          (await rooms.snapshot(owner)).members.find(
            (participant) => participant.id === id,
          )?.moderator ?? false,
        isConnected: async (id) =>
          (await rooms.snapshot(owner)).members.find(
            (participant) => participant.id === id,
          )?.connected ?? false,
        disconnectGuest: async () => {
          await rooms.disconnect(guest);
        },
        resumeGuest: async () => rooms.resume(guest.code, guest.token),
        duplicateNameIsRejected: async () => {
          try {
            await rooms.join(owner.code, ' bObBy ');
            return false;
          } catch {
            return true;
          }
        },
        close: async () => rooms.onModuleDestroy(),
      };
    },
  },
];

describe.each(domains)('$name shared collaboration contract', ({ setup }) => {
  it('normalizes unique names and assigns the same role and token guarantees', async () => {
    const room = await setup();
    try {
      expect(await room.names()).toEqual(['Alice', 'Bobby']);
      expect(await room.duplicateNameIsRejected()).toBe(true);
      expect(room.owner.token).toHaveLength(32);
      expect(room.guest.token).toHaveLength(32);
      expect(room.guest.token).not.toBe(room.owner.token);
      expect(await room.isModerator(room.owner.id)).toBe(true);
      expect(await room.isModerator(room.guest.id)).toBe(false);
    } finally {
      await room.close();
    }
  });

  it('retains a disconnected identity and restores it with the same token', async () => {
    const room = await setup();
    try {
      await room.disconnectGuest();
      expect(await room.isConnected(room.guest.id)).toBe(false);
      expect(await room.resumeGuest()).toEqual(room.guest);
      expect(await room.isConnected(room.guest.id)).toBe(true);
    } finally {
      await room.close();
    }
  });
});
