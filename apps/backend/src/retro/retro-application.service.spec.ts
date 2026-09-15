import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  materializeRetroState,
  type RetroServerEvent,
} from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RetroService } from './retro.service.js';

let application: RetroApplicationService;
let retro: RetroService;

beforeEach(() => {
  retro = new RetroService(
    new ParticipantService(),
    new RoomRegistryService(),
    new RetentionService(),
  );
  application = new RetroApplicationService(
    retro,
    new ConnectionRegistryService(),
    new ApplicationEventBus(),
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
  return { ...message.data, room: materializeRetroState(message.data) };
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
    const ownerGrouping = state(reveal, 'owner-connection').room;
    expect(ownerGrouping.phase).toBe('group');
    expect(ownerGrouping.notes).toHaveLength(2);
    expect(ownerGrouping.members.every((member) => !member.ready)).toBe(true);
    expect(state(reveal, 'guest-connection').room.notes).toHaveLength(2);

    const voting = application.execute('owner-connection', {
      type: 'advance',
    });
    const ownerVoting = state(voting, 'owner-connection').room;
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

  it('caches one public projection and recovers a missed version with one requester snapshot', () => {
    const publicSnapshot = vi.spyOn(retro, 'publicSnapshot');
    const created = application.execute('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const code = state(created, 'owner').room.code;
    application.execute('guest', { type: 'join', name: 'Bobby', code });
    const update = application.execute('owner', {
      type: 'add-note',
      column: 'ideas',
      text: 'Private note',
    });
    const stateMessages = update.messages.filter(
      (message) => (message.event as RetroServerEvent).event === 'retro-state',
    );
    expect(stateMessages).toHaveLength(2);
    const first = stateMessages[0].event as RetroServerEvent;
    const second = stateMessages[1].event as RetroServerEvent;
    if (first.event !== 'retro-state' || second.event !== 'retro-state')
      throw new Error('Expected state messages');
    expect(first.data.room).toBe(second.data.room);
    expect(
      update.messages.every(
        (message) => message.serialization?.publicRoom === first.data.room,
      ),
    ).toBe(true);
    expect(first.data.room.notes).toEqual([]);
    expect(JSON.stringify(first.data.room)).not.toContain(
      first.data.self.token,
    );
    expect(JSON.stringify(first.data.room)).not.toContain('voterIds');
    expect(first.data.recipient.notes).toMatchObject([
      { text: 'Private note', authorId: first.data.self.id },
    ]);
    expect(second.data.recipient.notes).toEqual([]);
    expect(publicSnapshot).toHaveBeenCalledTimes(3);
    expect(first.data.version).toBe(3);
    expect(second.data.version).toBe(first.data.version);

    const refreshed = application.execute(
      'guest',
      { type: 'refresh' },
      'refresh-1',
    );
    expect(refreshed.messages.map((message) => message.connectionId)).toEqual([
      'guest',
    ]);
    const refreshEvent = event(refreshed, 'guest');
    expect(refreshEvent).toMatchObject({
      event: 'retro-state',
      data: { version: 3, requestId: 'refresh-1' },
    });
    expect(publicSnapshot).toHaveBeenCalledTimes(3);
  });
});
