import { beforeEach, describe, expect, it } from 'vitest';
import type { RetroServerEvent } from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroService } from './retro.service.js';

let application: RetroApplicationService;

beforeEach(() => {
  application = new RetroApplicationService(
    new RetroService(new ParticipantService(), new RoomRegistryService()),
    new ConnectionRegistryService(),
  );
});

function event(
  applicationResult: ReturnType<RetroApplicationService['execute']>,
  connectionId: string,
): RetroServerEvent {
  return applicationResult.messages.find(
    (message) => message.connectionId === connectionId,
  )!.event as RetroServerEvent;
}

function state(
  applicationResult: ReturnType<RetroApplicationService['execute']>,
  connectionId: string,
) {
  const message = event(applicationResult, connectionId);
  if (message.event !== 'retro-state') throw new Error(JSON.stringify(message));
  return message.data;
}

describe('RetroApplicationService', () => {
  it('owns session routing, recipient privacy, and synchronized reveal', () => {
    const created = state(
      application.execute('owner-connection', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner-connection',
    );
    const joinedResult = application.execute('guest-connection', {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    const joined = state(joinedResult, 'guest-connection');
    expect(
      joinedResult.messages.map((message) => message.connectionId),
    ).toEqual(['owner-connection', 'guest-connection']);

    const ownerWrite = application.execute('owner-connection', {
      type: 'add-note',
      column: 'went-well',
      text: 'Owner thought',
    });
    expect(state(ownerWrite, 'owner-connection').room.notes).toHaveLength(1);
    expect(state(ownerWrite, 'guest-connection').room.notes).toEqual([]);
    const guestWrite = application.execute('guest-connection', {
      type: 'add-note',
      column: 'ideas',
      text: 'Guest thought',
    });
    expect(state(guestWrite, 'owner-connection').room.notes[0].text).toBe(
      'Owner thought',
    );
    expect(state(guestWrite, 'guest-connection').room.notes[0].text).toBe(
      'Guest thought',
    );

    const ready = application.execute('guest-connection', {
      type: 'toggle-ready',
    });
    expect(
      state(ready, 'owner-connection').room.members.find(
        (member) => member.name === 'Bobby',
      )?.ready,
    ).toBe(true);
    expect(
      state(ready, 'guest-connection').room.members.find(
        (member) => member.name === 'Bobby',
      )?.ready,
    ).toBe(true);

    const reveal = application.execute('owner-connection', { type: 'advance' });
    const ownerVoting = state(reveal, 'owner-connection').room;
    expect(ownerVoting.notes).toHaveLength(2);
    expect(ownerVoting.members.every((member) => !member.ready)).toBe(true);
    expect(state(reveal, 'guest-connection').room.notes).toHaveLength(2);

    const voted = application.execute('guest-connection', {
      type: 'toggle-vote',
      id: ownerVoting.notes[0].id,
    });
    expect(state(voted, 'owner-connection').room.notes[0]).toMatchObject({
      voteCount: null,
      votedBySelf: false,
    });
    expect(state(voted, 'guest-connection').room.notes[0]).toMatchObject({
      voteCount: null,
      votedBySelf: true,
    });
    expect(JSON.stringify(voted.messages)).not.toContain('voterIds');

    const discuss = application.execute('owner-connection', {
      type: 'advance',
    });
    expect(state(discuss, 'owner-connection').room.notes[0]).toMatchObject({
      voteCount: 1,
      votedBySelf: false,
    });
    expect(state(discuss, 'guest-connection').room.notes[0]).toMatchObject({
      voteCount: 1,
      votedBySelf: false,
    });
    expect(joined.self.token).not.toBe(created.self.token);
  });

  it('revokes and closes a participant removed by a moderator', () => {
    const created = state(
      application.execute('owner', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner',
    );
    const joined = state(
      application.execute('guest', {
        type: 'join',
        name: 'Bobby',
        code: created.room.code,
      }),
      'guest',
    );
    application.execute('guest', {
      type: 'add-note',
      column: 'ideas',
      text: 'Keep this attribution',
    });

    const removed = application.execute('owner', {
      type: 'remove-member',
      memberId: joined.self.id,
    });
    expect(event(removed, 'guest')).toMatchObject({
      event: 'retro-error',
      data: { code: 'removed' },
    });
    expect(removed.closes).toEqual([
      { connectionId: 'guest', code: 4003, reason: 'Removed by moderator' },
    ]);
    expect(state(removed, 'owner').room.members).toHaveLength(1);
    expect(
      event(
        application.execute('replacement', {
          type: 'resume',
          code: created.room.code,
          token: joined.self.token,
        }),
        'replacement',
      ),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
  });

  it('returns explicit replacement messages and close effects', () => {
    const created = state(
      application.execute('original', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'original',
    );
    const resumed = application.execute('replacement', {
      type: 'resume',
      code: created.room.code,
      token: created.self.token,
    });
    expect(event(resumed, 'original')).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    expect(state(resumed, 'replacement').self).toEqual(created.self);
    expect(resumed.closes).toEqual([
      {
        connectionId: 'original',
        code: 4001,
        reason: 'Session replaced',
      },
    ]);
    expect(
      event(
        application.execute('original', {
          type: 'add-note',
          column: 'ideas',
          text: 'Stale command',
        }),
        'original',
      ),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
  });

  it('accepts only the first moderator recovery claim', () => {
    const created = state(
      application.execute('owner', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner',
    );
    application.execute('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    application.execute('third', {
      type: 'join',
      name: 'Carol',
      code: created.room.code,
    });
    application.disconnect('owner');

    const accepted = application.execute('guest', {
      type: 'claim-moderator',
    });
    expect(
      state(accepted, 'guest').room.members.filter(
        (member) => member.moderator,
      ),
    ).toEqual([expect.objectContaining({ name: 'Bobby' })]);
    expect(
      event(application.execute('third', { type: 'claim-moderator' }), 'third'),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'moderator-active' },
    });
  });

  it('broadcasts disconnect presence without transport dependencies', () => {
    const created = state(
      application.execute('owner', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner',
    );
    application.execute('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    const disconnected = application.disconnect('guest');
    expect(disconnected.messages).toHaveLength(1);
    expect(disconnected.messages[0].connectionId).toBe('owner');
    expect(disconnected.messages[0].event).toMatchObject({
      event: 'retro-state',
      data: {
        room: {
          members: expect.arrayContaining([
            expect.objectContaining({ name: 'Bobby', connected: false }),
          ]),
        },
      },
    });
  });
});
