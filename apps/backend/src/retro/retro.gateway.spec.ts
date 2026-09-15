import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type Server, WebSocket } from 'ws';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroGateway } from './retro.gateway.js';
import { RetroModule } from './retro.module.js';
import { RETRO_LIFETIME_MS, RetroService } from './retro.service.js';

let gateway: RetroGateway;
let service: RetroService;
function socket() {
  const client = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
  } as unknown as WebSocket;
  gateway.handleConnection(client);
  return client;
}
function latest(client: WebSocket) {
  return JSON.parse(vi.mocked(client.send).mock.calls.at(-1)![0] as string);
}
beforeEach(async () => {
  vi.useFakeTimers();
  service = new RetroService(
    new ParticipantService(),
    new InMemoryRetroRoomRepository(),
  );
  const events = new ApplicationEventBus();
  const connections = new ConnectionRegistryService();
  gateway = new RetroGateway(
    new RetroApplicationService(service, connections, events),
    new WebSocketTransportService(),
    new WebSocketHeartbeatService(),
    new RateLimitService(),
    events,
  );
});
afterEach(async () => {
  gateway.onModuleDestroy();
  vi.useRealTimers();
});

describe('RetroGateway', () => {
  it('keeps closed broadcasts identical when sockets disconnect, resume or join late', async () => {
    const owner = socket();
    const guest = socket();
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Final',
    });
    const code = latest(owner).data.room.code;
    await gateway.onCommand(guest, { type: 'join', name: 'Bobby', code });
    const token = latest(guest).data.self.token;
    for (let i = 0; i < 4; i++)
      await gateway.onCommand(owner, { type: 'advance' });
    const final = latest(owner).data.room;
    expect(final.closedAt).toBe(Date.now());
    await gateway.handleDisconnect(guest);
    expect(latest(owner).data.room).toEqual(final);
    const returning = socket();
    await gateway.onCommand(returning, { type: 'resume', code, token });
    expect(latest(returning).data.room).toEqual(final);
    expect(latest(owner).data.room).toEqual(final);
    const late = socket();
    await gateway.onCommand(late, { type: 'join', code, name: 'Carol' });
    expect(latest(late)).toMatchObject({
      event: 'retro-error',
      data: { code: 'room-closed' },
    });
    expect(latest(owner).data.room).toEqual(final);
  });
  it('uses collaboration services through RetroModule dependency injection', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [RetroModule],
    }).compile();
    expect(testingModule.get(RetroGateway)).toBeInstanceOf(RetroGateway);
    expect(testingModule.get(RetroService)).toBeInstanceOf(RetroService);
    expect(testingModule.get(RetroApplicationService)).toBeInstanceOf(
      RetroApplicationService,
    );
    expect(testingModule.get(ParticipantService)).toBeInstanceOf(
      ParticipantService,
    );
    expect(testingModule.get(RoomRegistryService)).toBeInstanceOf(
      RoomRegistryService,
    );
    await testingModule.close();
  });

  it('acknowledges only the requesting socket, including rejected commands', async () => {
    const owner = socket();
    const guest = socket();
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
      requestId: 'create-1',
    });
    expect(latest(owner).data.requestId).toBe('create-1');
    await gateway.onCommand(guest, {
      type: 'join',
      name: 'Bobby',
      code: latest(owner).data.room.code,
      requestId: 'join-1',
    });
    expect(latest(guest).data.requestId).toBe('join-1');
    expect(latest(owner).data).not.toHaveProperty('requestId');
    await gateway.onCommand(guest, { type: 'advance', requestId: 'advance-1' });
    expect(latest(guest)).toMatchObject({
      event: 'retro-error',
      data: { code: 'forbidden', requestId: 'advance-1' },
    });
  });
  it('keeps protected rooms opaque and bounds password attempts', async () => {
    const owner = socket();
    const visitor = socket();
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Sensitive retro',
      password: 'secret',
    });
    const created = latest(owner).data;
    expect(created.room.requiresPassword).toBe(true);
    expect(JSON.stringify(created)).not.toContain('secret');

    await gateway.onCommand(visitor, {
      type: 'inspect',
      code: created.room.code,
    });
    expect(latest(visitor)).toEqual({
      event: 'retro-room-info',
      data: {
        code: created.room.code,
        available: true,
        requiresPassword: true,
      },
    });
    expect(JSON.stringify(latest(visitor))).not.toContain('Sensitive retro');

    for (let attempt = 0; attempt < 5; attempt++) {
      await gateway.onCommand(visitor, {
        type: 'join',
        code: created.room.code,
        name: `Guest ${attempt}`,
        password: 'wrong',
      });
      expect(latest(visitor)).toMatchObject({
        event: 'retro-error',
        data: { code: 'wrong-room-password' },
      });
    }
    await gateway.onCommand(visitor, {
      type: 'join',
      code: created.room.code,
      name: 'Bobby',
      password: 'wrong',
    });
    expect(latest(visitor)).toMatchObject({
      event: 'retro-error',
      data: { code: 'rate-limit' },
    });
    expect(await service.inspect(created.room.code)).toMatchObject({
      available: true,
      requiresPassword: true,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await gateway.onCommand(visitor, {
      type: 'join',
      code: created.room.code,
      name: 'Bobby',
      password: 'secret',
    });
    expect(latest(visitor)).toMatchObject({
      event: 'retro-state',
      data: {
        room: {
          members: expect.arrayContaining([
            expect.objectContaining({ name: 'Bobby' }),
          ]),
        },
      },
    });
  });

  it('expires attached rooms and cleans timers even without incoming messages', async () => {
    const owner = socket();
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const code = latest(owner).data.room.code;
    gateway.afterInit({ clients: new Set() } as Server);
    gateway.afterInit({ clients: new Set() } as Server);
    expect(vi.getTimerCount()).toBe(1);
    const pong = vi
      .mocked(owner.on)
      .mock.calls.find(([event]) => event === 'pong')![1];
    for (let elapsed = 0; elapsed < RETRO_LIFETIME_MS; elapsed += 30_000) {
      pong.call(owner);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(latest(owner)).toMatchObject({
      event: 'retro-error',
      data: { code: 'room-expired' },
    });
    expect(await service.isExpired(code)).toBe(true);
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'New room',
    });
    expect(latest(owner).data.room.code).not.toBe(code);
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks disconnects and sends only other members their own credentials', async () => {
    const owner = socket();
    const guest = socket();
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const created = latest(owner).data;
    await gateway.onCommand(guest, {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    await gateway.handleDisconnect(guest);
    expect(latest(owner).data.room.members[1].connected).toBe(false);
    expect(latest(owner).data.self).toEqual(created.self);
    await expect(gateway.handleDisconnect(guest)).resolves.not.toThrow();
  });

  it('limits command floods and recovers after the rate window', async () => {
    const owner = socket();
    for (let i = 0; i < 31; i++) await gateway.onCommand(owner, null);
    expect(latest(owner).data.code).toBe('rate-limit');
    vi.advanceTimersByTime(1000);
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    expect(latest(owner).event).toBe('retro-state');
  });

  it('pings clients and terminates unresponsive connections', async () => {
    const owner = socket();
    gateway.afterInit({ clients: new Set([owner]) } as Server);
    vi.advanceTimersByTime(30_000);
    expect(owner.ping).toHaveBeenCalledOnce();
    const pong = vi
      .mocked(owner.on)
      .mock.calls.find(([event]) => event === 'pong')![1];
    pong.call(owner);
    vi.advanceTimersByTime(30_000);
    expect(owner.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(owner.terminate).toHaveBeenCalledOnce();
  });
});
