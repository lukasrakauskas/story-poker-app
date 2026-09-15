import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { RoomAccessService } from '../collaboration/room-access.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import type { Client } from '../events/client.entity.js';
import { INVALID_COMMAND_ERROR } from '../events/events.schema.js';
import { RoomService } from '../events/room.service.js';
import { UserService } from '../events/user.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { PokerApplicationService } from './poker-application.service.js';
import { PokerGateway } from './poker.gateway.js';
import { PokerModule } from './poker.module.js';

let gateway: PokerGateway;
let application: PokerApplicationService;
let rooms: RoomService;

function client(id: string) {
  return {
    id,
    readyState: 1,
    send: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
  } as unknown as Client;
}

function messages(socket: Client) {
  return vi
    .mocked(socket.send)
    .mock.calls.map(([message]) => JSON.parse(message as string));
}

beforeEach(() => {
  const participants = new ParticipantService();
  const users = new UserService(participants);
  const events = new ApplicationEventBus();
  rooms = new RoomService(
    users,
    participants,
    new RoomRegistryService(),
    new RetentionService(),
    new RoomAccessService(),
  );
  application = new PokerApplicationService(
    new ConfigService(),
    rooms,
    users,
    new ConnectionRegistryService(),
    events,
  );
  gateway = new PokerGateway(
    application,
    new WebSocketTransportService(),
    new WebSocketHeartbeatService(),
    events,
  );
});

afterEach(() => {
  gateway.onModuleDestroy();
  application.onModuleDestroy();
  rooms.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PokerGateway transport contract', () => {
  it('wires the renamed gateway and application service through PokerModule', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [PokerModule],
    }).compile();
    expect(testingModule.get(PokerGateway)).toBeInstanceOf(PokerGateway);
    expect(testingModule.get(PokerApplicationService)).toBeInstanceOf(
      PokerApplicationService,
    );
    expect(testingModule.get(RoomService)).toBeInstanceOf(RoomService);
    expect(testingModule.get(ParticipantService)).toBeInstanceOf(
      ParticipantService,
    );
    await testingModule.close();
  });

  it('rejects malformed payloads before delegating to application use cases', () => {
    const socket = client('malformed');
    const applicationSpies = [
      vi.spyOn(application, 'inspect'),
      vi.spyOn(application, 'create'),
      vi.spyOn(application, 'join'),
      vi.spyOn(application, 'reconnect'),
      vi.spyOn(application, 'castVote'),
      vi.spyOn(application, 'reveal'),
      vi.spyOn(application, 'startVoting'),
      vi.spyOn(application, 'claimModerator'),
      vi.spyOn(application, 'promote'),
      vi.spyOn(application, 'kick'),
      vi.spyOn(application, 'changeAvatar'),
      vi.spyOn(application, 'broadcast'),
    ];
    const invalidCommands: [string, () => unknown][] = [
      ['keep-alive data', () => gateway.onKeepAlive(socket, {})],
      [
        'inspect unknown field',
        () => gateway.onInspectRoom({ room: 'room', extra: true }),
      ],
      ['create missing data', () => gateway.onCreateRoom(socket, undefined)],
      [
        'join wrong room type',
        () => gateway.onJoinRoom(socket, { name: 'Alice', room: 42 }),
      ],
      [
        'reconnect missing room',
        () => gateway.onReconnect(socket, { token: 'token' }),
      ],
      ['vote missing value', () => gateway.onCastVote(socket, {})],
      [
        'avatar wrong type',
        () => gateway.onChangeAvatar(socket, { avatar: '1' }),
      ],
      ['promote missing user', () => gateway.onPromoteUser(socket, {})],
      ['kick unknown field', () => gateway.onKickUser(socket, { extra: true })],
      ['claim data', () => gateway.onClaimModerator(socket, {})],
      ['reveal data', () => gateway.onRevealResults(socket, {})],
      ['start data', () => gateway.onStartVoting(socket, {})],
      [
        'oversized broadcast',
        () =>
          gateway.onBroadcastMessage({
            roomId: 'room',
            message: 'a'.repeat(1001),
            password: 'secret',
          }),
      ],
    ];

    for (const [label, invoke] of invalidCommands)
      expect(invoke(), label).toEqual(INVALID_COMMAND_ERROR);
    for (const spy of applicationSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('maps validated commands to application responses and transport events', () => {
    const owner = client('owner');
    const created = gateway.onCreateRoom(owner, { name: 'Alice' }) as {
      event: string;
      data: { code: string; user: { token: string } };
    };
    expect(created.event).toBe('room-joined');
    const guest = client('guest');
    expect(
      gateway.onJoinRoom(guest, {
        room: created.data.code,
        name: 'Bobby',
      }),
    ).toMatchObject({ event: 'room-joined' });
    expect(messages(owner).at(-1)).toMatchObject({ event: 'user-joined' });

    gateway.onCastVote(guest, { vote: '5' });
    expect(messages(owner).at(-1)).toMatchObject({
      event: 'user-voted',
      data: { user: { id: 'guest', voted: true } },
    });

    const replacement = client('replacement');
    expect(
      gateway.onReconnect(replacement, {
        room: created.data.code,
        token: created.data.user.token,
      }),
    ).toMatchObject({ event: 'room-joined' });
    expect(owner.close).toHaveBeenCalledWith(4000, 'Reconnected elsewhere');
  });

  it('delegates connection and heartbeat lifecycle to focused adapters', () => {
    vi.useFakeTimers();
    const owner = client('owner');
    gateway.handleConnection(owner);
    expect(messages(owner)).toEqual([{ event: 'is-alive' }]);
    gateway.onCreateRoom(owner, { name: 'Alice' });
    gateway.afterInit({ clients: new Set([owner]) } as never);
    gateway.afterInit({ clients: new Set([owner]) } as never);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(7000);
    expect(messages(owner).at(-1)).toEqual({ event: 'is-alive' });
    gateway.onKeepAlive(owner);
    vi.advanceTimersByTime(7000);
    expect(owner.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(7000);
    expect(owner.terminate).toHaveBeenCalledOnce();
    expect(messages(owner).at(-1)).toMatchObject({ event: 'user-left' });

    gateway.onModuleDestroy();
    rooms.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
