import { materializeRetroState } from 'shared/retrospective';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RetroServerEvent } from 'shared/retrospective';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroService } from './retro.service.js';

let application: RetroApplicationService;

beforeEach(() => {
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
  return { ...message.data, room: materializeRetroState(message.data) };
}

async function establish(
  connectionId: string,
  command: Extract<
    Parameters<RetroApplicationService['establish']>[0],
    { type: 'create' | 'join' }
  >,
) {
  const operation = await application.establish(command);
  const result = await application.execute(
    connectionId,
    { type: 'resume', code: operation.session.code },
    undefined,
    operation.session.token,
  );
  return { operation, state: state(result, connectionId), result };
}

describe('RetroApplicationService', () => {
  it('owns session routing, recipient privacy, and synchronized reveal', async () => {
    const created = await establish('owner-connection', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const joined = await establish('guest-connection', {
      type: 'join',
      name: 'Bobby',
      code: created.state.room.code,
    });
    expect(
      joined.result.messages.map((message) => message.connectionId),
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
    expect(state(voted, 'guest-connection').room.notes[0]).toMatchObject({
      voteCount: null,
      votedBySelf: true,
    });
    expect(JSON.stringify(voted.messages)).not.toContain('token');
    expect(JSON.stringify(voted.messages)).not.toContain('voterIds');

    const discuss = await application.execute('owner-connection', {
      type: 'advance',
    });
    expect(state(discuss, 'owner-connection').room.notes[0]).toMatchObject({
      voteCount: 1,
      votedBySelf: false,
    });
    expect(joined.operation.session.token).not.toBe(
      created.operation.session.token,
    );
  });

  it('protects entry with a repository-backed verifier and exposes inspection only', async () => {
    const created = await establish('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Sensitive retrospective',
      password: 'secret',
    });
    expect(created.state.room.requiresPassword).toBe(true);
    expect(JSON.stringify(created.state)).not.toContain('secret');

    const inspection = await application.execute(
      'visitor',
      { type: 'inspect', code: created.state.room.code },
      'inspect-1',
    );
    expect(event(inspection, 'visitor')).toEqual({
      event: 'retro-room-info',
      data: {
        code: created.state.room.code,
        available: true,
        requiresPassword: true,
        requestId: 'inspect-1',
      },
    });
    expect(JSON.stringify(inspection)).not.toContain('Sensitive retrospective');

    await expect(
      application.establish({
        type: 'join',
        name: 'Bobby',
        code: created.state.room.code,
        password: 'wrong',
      }),
    ).rejects.toThrow('Incorrect room password');
    const joined = await establish('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.state.room.code,
      password: 'secret',
    });
    await application.disconnect('guest');
    expect(
      state(
        await application.execute(
          'replacement',
          { type: 'resume', code: created.state.room.code },
          undefined,
          joined.operation.session.token,
        ),
        'replacement',
      ).self.id,
    ).toBe(joined.state.self.id);
  });

  it('revokes and closes a participant removed by a moderator', async () => {
    const created = await establish('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const joined = await establish('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.state.room.code,
    });
    await application.execute('guest', {
      type: 'add-note',
      column: 'ideas',
      text: 'Keep this attribution',
    });

    const removed = await application.execute('owner', {
      type: 'remove-member',
      memberId: joined.state.self.id,
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
        await application.execute(
          'replacement',
          { type: 'resume', code: created.state.room.code },
          undefined,
          joined.operation.session.token,
        ),
        'replacement',
      ),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
  });

  it('returns explicit replacement messages and close effects', async () => {
    const created = await establish('original', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const resumed = await application.execute(
      'replacement',
      { type: 'resume', code: created.state.room.code },
      undefined,
      created.operation.session.token,
    );
    expect(event(resumed, 'original')).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    expect(state(resumed, 'replacement').self.id).toBe(created.state.self.id);
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
    const created = await establish('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    await establish('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.state.room.code,
    });
    await establish('third', {
      type: 'join',
      name: 'Carol',
      code: created.state.room.code,
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

  it('broadcasts ephemeral drag presence only to room peers', async () => {
    const created = await establish('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const joined = await establish('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.state.room.code,
    });
    const presence = application.presence('guest', {
      x: 0.25,
      y: 0.75,
      noteId: 'note',
      active: true,
    });
    expect(presence.messages).toEqual([
      {
        connectionId: 'owner',
        event: {
          event: 'retro-presence',
          data: {
            memberId: joined.state.self.id,
            x: 0.25,
            y: 0.75,
            noteId: 'note',
            active: true,
          },
        },
      },
    ]);
    expect(
      application.presence('anonymous', {
        x: 0,
        y: 0,
        noteId: null,
        active: false,
      }).messages,
    ).toEqual([]);
  });

  it('broadcasts disconnect presence without transport dependencies', async () => {
    const created = await establish('owner', {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    await establish('guest', {
      type: 'join',
      name: 'Bobby',
      code: created.state.room.code,
    });
    const disconnected = await application.disconnect('guest');
    expect(disconnected.messages).toHaveLength(2);
    expect(disconnected.messages[0]).toMatchObject({
      connectionId: 'owner',
      event: {
        event: 'retro-presence',
        data: { memberId: expect.any(String), active: false },
      },
    });
    expect(disconnected.messages[1].connectionId).toBe('owner');
    expect(disconnected.messages[1].event).toMatchObject({
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
