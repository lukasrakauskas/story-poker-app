import { describe, expect, it } from 'vitest';
import {
  retroCommandMessageSchema,
  retroCommandSchema,
  retroInternalRoomSchema,
  retroPublicRoomSchema,
  retroServerEventSchema,
} from 'shared/retrospective';

const publicRoom = {
  code: 'room',
  title: 'Retro',
  phase: 'vote' as const,
  expiresAt: 1_800_000_000_000,
  closedAt: null,
  members: [
    {
      id: 'alice',
      name: 'Alice',
      moderator: true,
      connected: true,
      ready: false,
    },
  ],
  notes: [
    {
      id: 'note',
      authorId: 'alice',
      authorName: 'Alice',
      column: 'ideas' as const,
      text: 'Keep pairing',
      groupId: null,
      voteCount: null,
      votedBySelf: true,
    },
  ],
  groups: [],
  actions: [],
};

describe('shared retrospective contracts', () => {
  it('accepts acknowledgement metadata but rejects unknown command fields at every level', () => {
    expect(
      retroCommandMessageSchema.parse({
        type: 'add-action',
        text: 'Follow up',
        owner: { kind: 'external', name: 'Platform team' },
        requestId: 'request-1',
      }),
    ).toMatchObject({ requestId: 'request-1' });
    expect(
      retroCommandSchema.safeParse({
        type: 'add-action',
        text: 'Follow up',
        owner: { kind: 'external', name: 'Platform team', token: 'secret' },
      }).success,
    ).toBe(false);
    expect(
      retroCommandMessageSchema.safeParse({
        type: 'add-action',
        text: 'Follow up',
        owner: { kind: 'external', name: 'Platform team' },
        requestId: 'request-1',
        moderator: true,
      }).success,
    ).toBe(false);
  });

  it('keeps private internal state separate from public rooms and events', () => {
    const internal = {
      ...publicRoom,
      members: [
        {
          id: 'alice',
          name: 'Alice',
          role: 'moderator' as const,
          token: 'private-token',
          connected: true,
        },
      ],
      notes: [
        {
          id: 'note',
          authorId: 'alice',
          authorName: 'Alice',
          column: 'ideas' as const,
          text: 'Keep pairing',
          groupId: null,
          voterIds: ['alice'],
        },
      ],
      groups: [],
      readyMemberIds: new Set<string>(),
    };
    expect(retroInternalRoomSchema.parse(internal).members[0].token).toBe(
      'private-token',
    );
    expect(retroPublicRoomSchema.safeParse(internal).success).toBe(false);

    const event = {
      event: 'retro-state' as const,
      data: {
        room: publicRoom,
        self: { id: 'alice', token: 'private-token' },
      },
    };
    expect(retroServerEventSchema.safeParse(event).success).toBe(true);
    expect(
      retroServerEventSchema.safeParse({
        ...event,
        data: {
          ...event.data,
          room: {
            ...event.data.room,
            notes: [{ ...event.data.room.notes[0], voterIds: ['alice'] }],
          },
        },
      }).success,
    ).toBe(false);
  });
});
