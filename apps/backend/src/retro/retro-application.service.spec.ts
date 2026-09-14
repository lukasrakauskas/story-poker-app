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

    const reveal = application.execute('owner-connection', { type: 'advance' });
    expect(state(reveal, 'owner-connection').room.notes).toHaveLength(2);
    expect(state(reveal, 'guest-connection').room.notes).toHaveLength(2);
    expect(joined.self.token).not.toBe(created.self.token);
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
