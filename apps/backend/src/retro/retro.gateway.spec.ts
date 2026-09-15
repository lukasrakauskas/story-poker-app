import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type IncomingMessage } from 'node:http';
import { type Server, WebSocket } from 'ws';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { InMemoryRetroRoomRepository } from './retro-room.repository.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { OriginAllowlistService } from '../transport/origin-allowlist.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { WebSocketAdmissionService } from '../transport/websocket-admission.service.js';
import { TransportMetricsService } from '../transport/transport-metrics.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroGateway } from './retro.gateway.js';
import { RetroModule } from './retro.module.js';
import { RetroSessionCookieService } from './retro-session-cookie.service.js';
import { RETRO_LIFETIME_MS, RetroService } from './retro.service.js';

let gateway: RetroGateway;
let service: RetroService;
let cookies: RetroSessionCookieService;

function request(cookie?: string, origin?: string): IncomingMessage {
  return {
    headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage;
}

async function establish(
  type: 'create' | 'join',
  name: string,
  code?: string,
  password?: string,
) {
  return type === 'create'
    ? service.create(name, 'Retro', password)
    : service.join(code!, name, password);
}

function cookieFor(code: string, token: string): string {
  const output = { value: '' };
  cookies.set(
    {
      setHeader(_name: string, value: string) {
        output.value = value;
      },
    },
    code,
    token,
    Date.now() + RETRO_LIFETIME_MS,
  );
  return output.value.split(';', 1)[0];
}

function socket(cookie?: string, origin?: string) {
  const client = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
  } as unknown as WebSocket;
  gateway.handleConnection(client, request(cookie, origin));
  return client;
}

function latest(client: WebSocket) {
  return JSON.parse(vi.mocked(client.send).mock.calls.at(-1)![0] as string);
}

beforeEach(() => {
  vi.useFakeTimers();
  const repository = new InMemoryRetroRoomRepository();
  service = new RetroService(new ParticipantService(), repository);
  cookies = new RetroSessionCookieService();
  const events = new ApplicationEventBus();
  const metrics = new TransportMetricsService();
  gateway = new RetroGateway(
    new RetroApplicationService(
      service,
      new ConnectionRegistryService(),
      events,
    ),
    new WebSocketTransportService(),
    new WebSocketHeartbeatService(),
    new RateLimitService(),
    events,
    new WebSocketAdmissionService(new RateLimitService(), metrics),
    metrics,
    new OriginAllowlistService(),
    cookies,
  );
});
afterEach(() => {
  gateway.onModuleDestroy();
  vi.useRealTimers();
});

async function attach(
  session: { code: string; token: string },
  origin?: string,
) {
  const client = socket(cookieFor(session.code, session.token), origin);
  await gateway.onCommand(client, { type: 'resume', code: session.code });
  return client;
}

describe('RetroGateway', () => {
  it('keeps closed broadcasts identical when sockets disconnect, resume or join late', async () => {
    const ownerSession = await establish('create', 'Alice');
    const guestSession = await establish('join', 'Bobby', ownerSession.code);
    const owner = await attach(ownerSession);
    const guest = await attach(guestSession);
    for (let i = 0; i < 4; i++)
      await gateway.onCommand(owner, { type: 'advance' });
    const final = latest(owner).data.room;
    expect(final.closedAt).toBe(Date.now());
    await gateway.handleDisconnect(guest);
    expect(latest(owner).data.room).toEqual(final);
    const returning = await attach(guestSession);
    expect(latest(returning).data.room).toEqual(final);
    expect(latest(owner).data.room).toEqual(final);
    const late = socket();
    await gateway.onCommand(late, {
      type: 'join',
      code: ownerSession.code,
      name: 'Carol',
    });
    expect(latest(late)).toMatchObject({
      event: 'retro-error',
      data: { code: 'http-required' },
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
    await testingModule.close();
  });

  it('acknowledges only the requesting socket and never includes a credential', async () => {
    const ownerSession = await establish('create', 'Alice');
    const guestSession = await establish('join', 'Bobby', ownerSession.code);
    const owner = await attach(ownerSession);
    const guest = await attach(guestSession);
    await gateway.onCommand(guest, {
      type: 'toggle-ready',
      requestId: 'ready-1',
    });
    expect(latest(guest).data.requestId).toBe('ready-1');
    expect(latest(owner).data).not.toHaveProperty('requestId');
    expect(JSON.stringify(latest(owner))).not.toContain('token');
  });

  it('keeps protected room inspection opaque and requires HTTP entry', async () => {
    const ownerSession = await establish(
      'create',
      'Alice',
      undefined,
      'secret',
    );
    const visitor = socket();
    await gateway.onCommand(visitor, {
      type: 'inspect',
      code: ownerSession.code,
    });
    expect(latest(visitor)).toEqual({
      event: 'retro-room-info',
      data: {
        code: ownerSession.code,
        available: true,
        requiresPassword: true,
      },
    });
    expect(JSON.stringify(latest(visitor))).not.toContain('secret');
    await gateway.onCommand(visitor, {
      type: 'join',
      code: ownerSession.code,
      name: 'Bobby',
      password: 'secret',
    });
    expect(latest(visitor)).toMatchObject({
      event: 'retro-error',
      data: { code: 'http-required' },
    });
  });

  it('rejects disallowed WebSocket origins before admission', async () => {
    const evil = socket(undefined, 'https://evil.example');
    expect(evil.close).toHaveBeenCalledWith(1008, 'Origin not allowed');
    expect(vi.mocked(evil.send)).not.toHaveBeenCalled();
  });

  it('expires attached rooms and cleans timers even without incoming messages', async () => {
    const ownerSession = await establish('create', 'Alice');
    const owner = await attach(ownerSession);
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
    expect(await service.isExpired(ownerSession.code)).toBe(true);
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks disconnects without sending credentials in room state', async () => {
    const ownerSession = await establish('create', 'Alice');
    const guestSession = await establish('join', 'Bobby', ownerSession.code);
    const owner = await attach(ownerSession);
    const guest = await attach(guestSession);
    await gateway.handleDisconnect(guest);
    expect(latest(owner).data.room.members[1].connected).toBe(false);
    expect(latest(owner).data.self).toEqual({ id: ownerSession.id });
    expect(JSON.stringify(latest(owner))).not.toContain('token');
    await expect(gateway.handleDisconnect(guest)).resolves.not.toThrow();
  });

  it('limits command floods and rejects transport entry after the rate window', async () => {
    const owner = socket();
    for (let i = 0; i < 31; i++) await gateway.onCommand(owner, null);
    expect(latest(owner).data.code).toBe('rate-limit');
    vi.advanceTimersByTime(1000);
    await gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    expect(latest(owner)).toMatchObject({
      event: 'retro-error',
      data: { code: 'http-required' },
    });
  });

  it('pings clients and terminates unresponsive connections', async () => {
    const ownerSession = await establish('create', 'Alice');
    const owner = await attach(ownerSession);
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
