import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomAccessService } from '../collaboration/room-access.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import {
  OFFLINE_USER_RETENTION_MS,
  RoomService,
} from '../events/room.service.js';
import { UserService } from '../events/user.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import {
  POKER_APPLICATION_NAMESPACE,
  PokerApplicationService,
} from './poker-application.service.js';

let application: PokerApplicationService;
let rooms: RoomService;
let config: ConfigService;
let events: ApplicationEventBus;

beforeEach(() => {
  const participants = new ParticipantService();
  const users = new UserService(participants);
  config = new ConfigService();
  events = new ApplicationEventBus();
  rooms = new RoomService(
    users,
    participants,
    new RoomRegistryService(),
    new RetentionService(),
    new RoomAccessService(),
  );
  application = new PokerApplicationService(
    config,
    rooms,
    users,
    new ConnectionRegistryService(),
    events,
  );
});

afterEach(() => {
  application.onModuleDestroy();
  rooms.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function create(connectionId = 'owner') {
  const created = application.create(connectionId, { name: 'Alice' });
  expect(created.response).toMatchObject({ event: 'room-joined' });
  return created.response.data as {
    code: string;
    user: { id: string; token: string };
  };
}

describe('PokerApplicationService', () => {
  it('returns explicit responses and audience-addressed domain events', () => {
    const room = create();
    const joined = application.join('guest', {
      room: room.code,
      name: 'Bobby',
    });
    expect(joined.response).toMatchObject({
      event: 'room-joined',
      data: { user: { id: 'guest', role: 'user' } },
    });
    expect(joined.messages).toEqual([
      {
        connectionId: 'owner',
        event: expect.objectContaining({ event: 'user-joined' }),
      },
    ]);

    const vote = application.castVote('guest', { vote: '5' });
    expect(vote.response).toBeUndefined();
    expect(vote.messages.map((message) => message.connectionId)).toEqual([
      'owner',
      'guest',
    ]);
    expect(vote.messages[0].event).toMatchObject({
      event: 'user-voted',
      data: { user: { id: 'guest', voted: true } },
    });

    expect(application.reveal('guest').response).toEqual({
      event: 'user-not-mod',
      data: null,
    });
    expect(application.reveal('owner').messages[0].event).toMatchObject({
      event: 'results-revealed',
      data: { results: { '5': 1 } },
    });
  });

  it('replaces a live connection by ID without depending on WebSocket', () => {
    const room = create();
    const resumed = application.reconnect('replacement', {
      room: room.code,
      token: room.user.token,
    });
    expect(resumed.response).toMatchObject({
      event: 'room-joined',
      data: { user: { id: room.user.id } },
    });
    expect(resumed.closes).toEqual([
      {
        connectionId: 'owner',
        code: 4000,
        reason: 'Reconnected elsewhere',
      },
    ]);
    expect(application.castVote('owner', { vote: '3' }).response).toEqual({
      event: 'room-not-found',
      data: null,
    });
    expect(
      application.castVote('replacement', { vote: '3' }).messages,
    ).toHaveLength(1);
  });

  it('publishes participant expiry through an application event bus', () => {
    vi.useFakeTimers();
    const published: unknown[] = [];
    events.on(POKER_APPLICATION_NAMESPACE, (event) => published.push(event));
    const room = create();
    application.join('guest', { room: room.code, name: 'Bobby' });
    application.disconnect('guest');

    vi.advanceTimersByTime(OFFLINE_USER_RETENTION_MS);
    expect(published).toEqual([
      expect.objectContaining({
        messages: [
          {
            connectionId: 'owner',
            event: { event: 'user-removed', data: { userId: 'guest' } },
          },
        ],
      }),
    ]);
  });

  it('authorizes administrative broadcasts without transport objects', () => {
    const room = create();
    vi.spyOn(config, 'get').mockReturnValue('secret');
    expect(
      application.broadcast({
        roomId: room.code,
        message: 'Maintenance soon',
        password: 'wrong',
      }).response,
    ).toEqual({ event: 'wrong-password', data: null });
    const broadcast = application.broadcast({
      roomId: room.code,
      message: 'Maintenance soon',
      password: 'secret',
    });
    expect(broadcast.response).toEqual({
      event: 'message-broadcasted',
      data: null,
    });
    expect(broadcast.messages).toEqual([
      {
        connectionId: 'owner',
        event: {
          event: 'broadcasted-message',
          data: { message: 'Maintenance soon' },
        },
      },
    ]);
  });
});
