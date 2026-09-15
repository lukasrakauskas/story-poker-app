import { beforeEach, describe, expect, it } from 'vitest';
import type { RetroServerEvent } from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { RetroApplicationService } from './retro-application.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RetroService } from './retro.service.js';

let application: RetroApplicationService;

beforeEach(async () => {
  application = new RetroApplicationService(
    new RetroService(
      new ParticipantService(),
      new InMemoryRetroRoomRepository(),
    ),
    new ConnectionRegistryService(),
    new ApplicationEventBus(),
  );
});

function event(
  applicationResult: Awaited<ReturnType<RetroApplicationService['execute']>>,
  connectionId: string,
): RetroServerEvent {
  return applicationResult.messages.find(
    (message) => message.connectionId === connectionId,
  )!.event as RetroServerEvent;
}

function state(
  applicationResult: Awaited<ReturnType<RetroApplicationService['execute']>>,
  connectionId: string,
) {
  const message = event(applicationResult, connectionId);
  if (message.event !== 'retro-state') throw new Error(JSON.stringify(message));
  return message.data;
}

describe('RetroApplicationService', () => {
  it('owns session routing, recipient privacy, and synchronized reveal', async () => {
    const created = state(
      await application.execute('owner-connection', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner-connection',
    );
    const joinedResult = await application.execute('guest-connection', {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    const joined = state(joinedResult, 'guest-connection');
    expect(
      joinedResult.messages.map((message) => message.connectionId),
    ).toEqual(['owner-connection', 'guest-connection']);

    const ownerWrite = await application.execute('owner-connection', {
      type: 'add-note',
      column: 'went-well',
      text: 'Owner thought',
    });
    expect(state(ownerWrite, 'owner-connection').room.notes).toHaveLength(1);
    expect(state(ownerWrite, 'guest-connection').room.notes).toEqual([]);
    const guestWrite = await application.execute('guest-connection', {
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

    const ready = await application.execute('guest-connection', {
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

    const reveal = await application.execute('owner-connection', {
      type: 'advance',
    });
    const ownerGrouping = state(reveal, 'owner-connection').room;
    expect(ownerGrouping.phase).toBe('group');
    expect(ownerGrouping.notes).toHaveLength(2);
    expect(ownerGrouping.members.every((member) => !member.ready)).toBe(true);
    expect(state(reveal, 'guest-connection').room.notes).toHaveLength(2);

    const voting = await application.execute('owner-connection', {
      type: 'advance',
    });
    const ownerVoting = state(voting, 'owner-connection').room;
    const voted = await application.execute('guest-connection', {
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

    const discuss = await application.execute('owner-connection', {
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

  it('revokes and closes a participant removed by a moderator', async () => {
    const created = state(
      await application.execute('owner', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner',
    );
    const joined = state(
      await application.execute('guest', {
        type: 'join',
        name: 'Bobby',
        code: created.room.code,
      }),
      'guest',
    );
    await application.execute('guest', {
      type: 'add-note',
      column: 'ideas',
      text: 'Keep this attribution',
    });

    const removed = await application.execute('owner', {
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
        await application.execute('replacement', {
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

  it('returns explicit replacement messages and close effects', async () => {
    const created = state(
      await application.execute('original', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'original',
    );
    const resumed = await application.execute('replacement', {
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
        await application.execute('original', {
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

  it('accepts only the first moderator recovery claim', async () => {
    const created = state(
      await application.execute('owner', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner',
    );
    await application.execute('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    await application.execute('third', {
      type: 'join',
      name: 'Carol',
      code: created.room.code,
    });
    await application.disconnect('owner');

    const accepted = await application.execute('guest', {
      type: 'claim-moderator',
    });
    expect(
      state(accepted, 'guest').room.members.filter(
        (member) => member.moderator,
      ),
    ).toEqual([expect.objectContaining({ name: 'Bobby' })]);
    expect(
      event(
        await application.execute('third', { type: 'claim-moderator' }),
        'third',
      ),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'moderator-active' },
    });
  });

  it('broadcasts disconnect presence without transport dependencies', async () => {
    const created = state(
      await application.execute('owner', {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
      'owner',
    );
    await application.execute('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    const disconnected = await application.disconnect('guest');
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
