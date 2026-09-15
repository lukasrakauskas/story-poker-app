import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type Server, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
import { RetentionService } from '../collaboration/retention.service.js';
import { ApplicationEventBus } from '../transport/application-event-bus.service.js';
import { OriginAllowlistService } from '../transport/origin-allowlist.service.js';
import { RateLimitService } from '../transport/rate-limit.service.js';
import { WebSocketHeartbeatService } from '../transport/websocket-heartbeat.service.js';
import { WebSocketTransportService } from '../transport/websocket-transport.service.js';
import { RetroApplicationService } from './retro-application.service.js';
import { RetroSessionCookieService } from './retro-session-cookie.service.js';
import { RetroGateway } from './retro.gateway.js';
import { RetroModule } from './retro.module.js';
import { RETRO_LIFETIME_MS, RetroService } from './retro.service.js';

let gateway: RetroGateway;
let service: RetroService;
let application: RetroApplicationService;
const cookies = new RetroSessionCookieService();
function socket(token?: { code: string; token: string }, origin?: string) {
  const client = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
  } as unknown as WebSocket;
  gateway.handleConnection(client, {
    headers: {
      cookie: token ? `${cookies.name(token.code)}=${token.token}` : undefined,
      origin,
    },
  } as IncomingMessage);
  return client;
}
function latest(client: WebSocket) {
  return JSON.parse(vi.mocked(client.send).mock.calls.at(-1)![0] as string);
}
function enter(
  command: { type: 'create'; name: string; title: string },
  requestId?: string,
) {
  const session = application.establish(command).session;
  const client = socket(session);
  gateway.onCommand(client, {
    type: 'resume',
    code: session.code,
    ...(requestId ? { requestId } : {}),
  });
  return { client, session };
}
function join(code: string, name: string, requestId?: string) {
  const session = application.establish({ type: 'join', code, name }).session;
  const client = socket(session);
  gateway.onCommand(client, {
    type: 'resume',
    code,
    ...(requestId ? { requestId } : {}),
  });
  return { client, session };
}
beforeEach(() => {
  vi.useFakeTimers();
  service = new RetroService(
    new ParticipantService(),
    new RoomRegistryService(),
    new RetentionService(),
  );
  const events = new ApplicationEventBus();
  const connections = new ConnectionRegistryService();
  application = new RetroApplicationService(service, connections, events);
  gateway = new RetroGateway(
    application,
    new WebSocketTransportService(),
    new WebSocketHeartbeatService(),
    new RateLimitService(),
    new OriginAllowlistService(),
    cookies,
    events,
  );
});
afterEach(() => {
  gateway.onModuleDestroy();
  vi.useRealTimers();
});

describe('RetroGateway', () => {
  it('keeps closed broadcasts identical when sockets disconnect, resume or join late', () => {
    const ownerEntry = enter({ type: 'create', name: 'Alice', title: 'Final' });
    const owner = ownerEntry.client;
    const guestEntry = join(ownerEntry.session.code, 'Bobby');
    const guest = guestEntry.client;
    const code = ownerEntry.session.code;
    const token = guestEntry.session.token;
    for (let i = 0; i < 4; i++) gateway.onCommand(owner, { type: 'advance' });
    const final = latest(owner).data.room;
    expect(final.closedAt).toBe(Date.now());
    gateway.handleDisconnect(guest);
    expect(latest(owner).data.room).toEqual(final);
    const returning = socket({ code, token });
    gateway.onCommand(returning, { type: 'resume', code });
    expect(latest(returning).data.room).toEqual(final);
    expect(latest(owner).data.room).toEqual(final);
    expect(() => service.join(code, 'Carol')).toThrow(
      'New participants cannot join',
    );
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

  it('acknowledges only the requesting socket, including rejected commands', () => {
    const owner = enter(
      { type: 'create', name: 'Alice', title: 'Retro' },
      'create-1',
    ).client;
    expect(latest(owner).data.requestId).toBe('create-1');
    const guest = join(latest(owner).data.room.code, 'Bobby', 'join-1').client;
    expect(latest(guest).data.requestId).toBe('join-1');
    expect(latest(owner).data).not.toHaveProperty('requestId');
    gateway.onCommand(guest, { type: 'advance', requestId: 'advance-1' });
    expect(latest(guest)).toMatchObject({
      event: 'retro-error',
      data: { code: 'forbidden', requestId: 'advance-1' },
    });
  });
  it('expires attached rooms and cleans timers even without incoming messages', () => {
    const ownerEntry = enter({ type: 'create', name: 'Alice', title: 'Retro' });
    const owner = ownerEntry.client;
    const code = ownerEntry.session.code;
    gateway.afterInit({ clients: new Set() } as Server);
    gateway.afterInit({ clients: new Set() } as Server);
    expect(vi.getTimerCount()).toBe(1);
    const pong = vi
      .mocked(owner.on)
      .mock.calls.find(([event]) => event === 'pong')![1];
    for (let elapsed = 0; elapsed < RETRO_LIFETIME_MS; elapsed += 30_000) {
      pong.call(owner);
      vi.advanceTimersByTime(30_000);
    }
    expect(latest(owner)).toMatchObject({
      event: 'retro-error',
      data: { code: 'room-expired' },
    });
    expect(service.isExpired(code)).toBe(true);
    const fresh = application.establish({
      type: 'create',
      name: 'Alice',
      title: 'New room',
    });
    expect(fresh.session.code).not.toBe(code);
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks disconnects without placing credentials in broadcasts', () => {
    const ownerEntry = enter({ type: 'create', name: 'Alice', title: 'Retro' });
    const owner = ownerEntry.client;
    const guest = join(ownerEntry.session.code, 'Bobby').client;
    const created = latest(owner).data;
    gateway.handleDisconnect(guest);
    expect(latest(owner).data.room.members[1].connected).toBe(false);
    expect(latest(owner).data.self).toEqual(created.self);
    expect(JSON.stringify(latest(owner))).not.toContain('token');
    expect(() => gateway.handleDisconnect(guest)).not.toThrow();
  });

  it('limits command floods and recovers after the rate window', () => {
    const owner = enter({
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    }).client;
    for (let i = 0; i < 31; i++) gateway.onCommand(owner, null);
    expect(latest(owner).data.code).toBe('rate-limit');
    vi.advanceTimersByTime(1000);
    gateway.onCommand(owner, {
      type: 'add-note',
      column: 'ideas',
      text: 'After the window',
    });
    expect(latest(owner).event).toBe('retro-state');
  });

  it('rejects disallowed WebSocket origins and room-mismatched cookies', () => {
    const blocked = socket(undefined, 'https://evil.example');
    expect(blocked.close).toHaveBeenCalledWith(1008, 'Origin not allowed');

    const first = enter({ type: 'create', name: 'Alice', title: 'First' });
    const second = enter({ type: 'create', name: 'Carol', title: 'Second' });
    const mismatched = socket(first.session);
    gateway.onCommand(mismatched, {
      type: 'resume',
      code: second.session.code,
    });
    expect(latest(mismatched)).toMatchObject({
      event: 'retro-error',
      data: { code: 'session-required' },
    });
  });

  it('pings clients and terminates unresponsive connections', () => {
    const owner = enter({
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    }).client;
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
