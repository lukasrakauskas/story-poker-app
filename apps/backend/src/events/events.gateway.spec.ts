import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { EventsModule } from './events.module.js';
import { RoomService } from './room.service.js';
import { UserService } from './user.service.js';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway.js';
import type { Client } from './client.entity.js';

let gateway: EventsGateway;
let clients: Set<Client>;
let config: ConfigService;

function client(id: string) {
  const socket = {
    id,
    isAlive: true,
    readyState: 1,
    send: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
  } as unknown as Client;
  clients.add(socket);
  return socket;
}

function create(
  socket: Client,
  name = 'Moderator',
  cardSet?: string[],
  password?: string,
) {
  const response = gateway.onCreateRoom(socket, { name, cardSet, password });
  expect(response.event).toBe('room-joined');
  if (!response.data || !('code' in response.data))
    throw new Error('Room creation failed');
  return response.data;
}

function messages(socket: Client) {
  return vi
    .mocked(socket.send)
    .mock.calls.map(([message]) => JSON.parse(message as string));
}

beforeEach(() => {
  clients = new Set();
  config = new ConfigService();
  const users = new UserService();
  gateway = new EventsGateway(config, new RoomService(users), users);
  gateway.server = { clients } as typeof gateway.server;
});

afterEach(() => {
  gateway.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('wires gateway services through Nest dependency injection', async () => {
  const testingModule = await Test.createTestingModule({
    imports: [EventsModule],
  }).compile();
  expect(testingModule.get(EventsGateway)).toBeInstanceOf(EventsGateway);
  expect(testingModule.get(RoomService)).toBeInstanceOf(RoomService);
  expect(testingModule.get(UserService)).toBeInstanceOf(UserService);
  await testingModule.close();
});

describe('connection lifecycle', () => {
  it('terminates unresponsive clients and cleans up the heartbeat on shutdown', () => {
    vi.useFakeTimers();
    const owner = client('owner');
    create(owner);
    gateway.afterInit(gateway.server);
    gateway.afterInit(gateway.server);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(7000);
    expect(owner.isAlive).toBe(false);
    expect(messages(owner).at(-1)).toEqual({ event: 'is-alive' });
    gateway.onKeepAlive(owner);
    vi.advanceTimersByTime(7000);
    expect(owner.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(7000);
    expect(owner.terminate).toHaveBeenCalledOnce();
    expect(messages(owner).at(-1)).toMatchObject({ event: 'user-left' });
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('initializes a plain WebSocket without replacing its identity', () => {
    const socket = { send: vi.fn() } as unknown as Client;
    gateway.handleConnection(socket);
    const id = socket.id;
    expect(id).toEqual(expect.any(String));
    expect(id.length).toBeGreaterThan(0);
    expect(socket.isAlive).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'is-alive' }),
    );
    gateway.handleConnection(socket);
    expect(socket.id).toBe(id);
    socket.isAlive = false;
    gateway.onKeepAlive(socket);
    expect(socket.isAlive).toBe(true);
  });

  it('disconnects and reconnects the same user using a private token', () => {
    const owner = client('owner');
    const room = create(owner);
    gateway.onCastVote(owner, { vote: '5' });
    gateway.handleDisconnect(owner);
    expect(messages(owner).at(-1)).toMatchObject({
      event: 'user-left',
      data: { user: { status: 'disconnected', voted: true } },
    });
    const replacement = client('replacement');
    const response = gateway.onReconnect(replacement, {
      token: room.user.token,
    });
    expect(response).toMatchObject({
      event: 'room-joined',
      data: {
        code: room.code,
        user: { id: 'owner', status: 'connected', vote: '5' },
      },
    });
    expect(replacement.id).toBe('owner');
    expect(replacement.roomId).toBe(room.code);
    expect(owner.roomId).toBe('');
    expect(owner.close).toHaveBeenCalledWith(4000, 'Reconnected elsewhere');
    expect(messages(replacement).at(-1).data.user).not.toHaveProperty('token');
    expect(gateway.onReconnect(replacement, { token: 'invalid' })).toEqual({
      event: 'room-not-found',
      data: null,
    });
    expect(() => gateway.handleDisconnect(client('unknown'))).not.toThrow();
  });
});

describe('room membership', () => {
  it('creates independent rooms with default or custom cards and private tokens', () => {
    const first = create(client('first'));
    const second = create(client('second'), 'Another', ['yes', 'no']);
    expect(first.code).not.toBe(second.code);
    expect(first.cardSet).toEqual([
      '0',
      '1/2',
      '1',
      '2',
      '3',
      '5',
      '8',
      '13',
      '20',
      '40',
      '100',
      '?',
    ]);
    expect(second.cardSet).toEqual(['yes', 'no']);
    expect(first.user).toMatchObject({
      role: 'mod',
      vote: null,
      voted: false,
      status: 'connected',
    });
    expect(first.user.token).toHaveLength(32);
    expect(first.users[0]).not.toHaveProperty('token');
    expect(first.users[0]).not.toHaveProperty('vote');
  });

  it.each(['ab', 'a'.repeat(31)])(
    'rejects invalid username %s on create and join',
    (name) => {
      const owner = client('owner');
      expect(gateway.onCreateRoom(owner, { name })).toMatchObject({
        event: 'bad-username',
        data: { error: expect.any(String) },
      });
      const room = create(owner);
      expect(
        gateway.onJoinRoom(client('guest'), { name, room: room.code }),
      ).toMatchObject({ event: 'bad-username' });
    },
  );

  it('joins once, hides votes and broadcasts only to existing open room members', () => {
    const owner = client('owner');
    const room = create(owner);
    gateway.onCastVote(owner, { vote: '8' });
    const stranger = client('stranger');
    create(stranger, 'Stranger');
    const guest = client('guest');
    const response = gateway.onJoinRoom(guest, {
      name: 'Guest',
      room: room.code,
    });
    expect(response).toMatchObject({
      event: 'room-joined',
      data: {
        users: [
          { id: 'owner', voted: true },
          { id: 'guest', voted: false },
        ],
        user: { role: 'user' },
      },
    });
    expect(JSON.stringify(response)).not.toContain('"vote":"8"');
    expect(messages(owner).at(-1)).toMatchObject({
      event: 'user-joined',
      data: { user: { id: 'guest' } },
    });
    expect(messages(guest)).toEqual([]);
    expect(messages(stranger)).toEqual([]);
    expect(
      gateway.onJoinRoom(guest, { name: 'Guest', room: room.code }),
    ).toEqual({ event: 'name-taken', data: null });
    expect(
      gateway.onJoinRoom(guest, { name: 'Guest', room: 'missing' }),
    ).toEqual({ event: 'room-not-found', data: null });
    Object.defineProperty(guest, 'readyState', { value: 3 });
    gateway.onCastVote(owner, { vote: '3' });
    expect(messages(guest)).toEqual([]);
  });

  it('requires the configured room password and does not expose it', () => {
    const owner = client('owner');
    const room = create(owner, 'Moderator', undefined, 'secret');
    const guest = client('guest');
    expect(
      gateway.onJoinRoom(guest, { name: 'Guest', room: room.code }),
    ).toEqual({ event: 'wrong-room-password', data: null });
    const joined = gateway.onJoinRoom(guest, {
      name: 'Guest',
      room: room.code,
      password: 'secret',
    });
    expect(joined).toMatchObject({
      event: 'room-joined',
      data: { requiresPassword: true },
    });
    expect(JSON.stringify(joined)).not.toContain('secret');
  });

  it('broadcasts avatar and moderator changes and removes kicked users', () => {
    const owner = client('owner');
    const room = create(owner);
    const guest = client('guest');
    const joined = gateway.onJoinRoom(guest, {
      name: 'Guest',
      room: room.code,
    });
    if (!joined.data || !('user' in joined.data)) {
      throw new Error('Room join failed');
    }
    const guestToken = joined.data.user.token;

    gateway.onChangeAvatar(guest, { avatar: 3 });
    expect(messages(owner).at(-1)).toMatchObject({
      event: 'user-updated',
      data: { user: { id: 'guest', avatar: 3 } },
    });
    expect(gateway.onPromoteUser(guest, { userId: 'guest' })).toEqual({
      event: 'user-not-mod',
      data: null,
    });
    gateway.onPromoteUser(owner, { userId: 'guest' });
    expect(messages(guest).at(-1)).toMatchObject({
      event: 'user-updated',
      data: { user: { id: 'guest', role: 'mod' } },
    });
    expect(gateway.onKickUser(owner, { userId: 'owner' })).toEqual({
      event: 'cannot-kick-self',
      data: null,
    });
    gateway.onKickUser(owner, { userId: 'guest' });
    expect(messages(guest).at(-1)).toEqual({ event: 'kicked', data: null });
    expect(guest.close).toHaveBeenCalledWith(4001, 'Removed from room');
    expect(messages(owner).at(-1)).toEqual({
      event: 'user-removed',
      data: { userId: 'guest' },
    });
    expect(gateway.onReconnect(client('new'), { token: guestToken })).toEqual({
      event: 'room-not-found',
      data: null,
    });
  });
});

describe('voting', () => {
  it('reveals counts only for moderators and restores the latest state', () => {
    const owner = client('owner');
    const room = create(owner);
    const guest = client('guest');
    gateway.onJoinRoom(guest, { name: 'Guest', room: room.code });
    gateway.onJoinRoom(client('abstainer'), {
      name: 'Abstainer',
      room: room.code,
    });
    gateway.onCastVote(owner, { vote: '5' });
    gateway.onCastVote(guest, { vote: '5' });
    expect(messages(owner).at(-1).data.user).toEqual({
      id: 'guest',
      name: 'Guest',
      role: 'user',
      status: 'connected',
      avatar: null,
      voted: true,
    });
    expect(gateway.onRevealResults(guest)).toEqual({
      event: 'user-not-mod',
      data: null,
    });
    gateway.onRevealResults(owner);
    const revealed = messages(owner).at(-1);
    expect(revealed.event).toBe('results-revealed');
    expect(revealed.data.results).toEqual({ '5': 2 });
    expect(
      revealed.data.users.map((user: { vote: string | null }) => user.vote),
    ).toEqual(['5', '5', null]);
    expect(JSON.stringify(revealed)).not.toContain('token');
    const replacement = client('new');
    expect(
      gateway.onReconnect(replacement, {
        token: room.user.token,
        room: room.code,
      }),
    ).toMatchObject({
      data: {
        state: 'results',
        results: { '5': 2 },
        user: { vote: '5' },
        users: expect.arrayContaining([
          expect.objectContaining({ id: 'guest', vote: '5' }),
        ]),
      },
    });
    expect(gateway.onCastVote(guest, { vote: '8' })).toEqual({
      event: 'voting-not-active',
      data: null,
    });
    expect(gateway.onStartVoting(guest)).toEqual({
      event: 'user-not-mod',
      data: null,
    });
    gateway.onStartVoting(replacement);
    expect(messages(replacement).at(-1)).toEqual({
      event: 'voting-started',
      data: null,
    });
    expect(
      gateway.onReconnect(client('newer'), { token: room.user.token }),
    ).toMatchObject({
      data: {
        state: 'voting',
        users: expect.arrayContaining([
          expect.objectContaining({ id: 'guest', voted: false }),
        ]),
      },
    });
  });

  it.each(['onCastVote', 'onRevealResults', 'onStartVoting'] as const)(
    '%s rejects missing rooms and users',
    (method) => {
      const unknown = client('unknown');
      expect(gateway[method](unknown, { vote: '1' })).toEqual({
        event: 'room-not-found',
        data: null,
      });
      unknown.roomId = create(client('owner')).code;
      expect(gateway[method](unknown, { vote: '1' })).toEqual({
        event: 'user-not-found',
        data: null,
      });
    },
  );
});

it('authorizes administrative broadcasts and handles missing rooms', () => {
  const owner = client('owner');
  const room = create(owner);
  const data = { roomId: room.code, message: 'Hello', password: 'secret' };
  vi.spyOn(config, 'get').mockReturnValue(undefined);
  expect(gateway.onBroadcastMessage(data)).toEqual({
    event: 'message-broadcasted',
    data: null,
  });
  expect(messages(owner)).toEqual([]);
  vi.mocked(config.get).mockReturnValue('secret');
  expect(gateway.onBroadcastMessage({ ...data, password: 'wrong' })).toEqual({
    event: 'wrong-password',
    data: null,
  });
  expect(gateway.onBroadcastMessage({ ...data, roomId: 'missing' })).toEqual({
    event: 'room-not-found',
    data: null,
  });
  expect(gateway.onBroadcastMessage(data)).toEqual({
    event: 'message-broadcasted',
    data: null,
  });
  expect(messages(owner)).toEqual([
    { event: 'broadcasted-message', data: { message: 'Hello' } },
  ]);
});
