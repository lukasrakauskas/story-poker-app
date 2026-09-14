import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type Server, WebSocket } from 'ws';
import { ConnectionRegistryService } from '../collaboration/connection-registry.service.js';
import { ParticipantService } from '../collaboration/participant.service.js';
import { RoomRegistryService } from '../collaboration/room-registry.service.js';
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
beforeEach(() => {
  vi.useFakeTimers();
  service = new RetroService(
    new ParticipantService(),
    new RoomRegistryService(),
  );
  gateway = new RetroGateway(service, new ConnectionRegistryService());
});
afterEach(() => {
  gateway.onModuleDestroy();
  vi.useRealTimers();
});

describe('RetroGateway', () => {
  it('uses collaboration services through RetroModule dependency injection', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [RetroModule],
    }).compile();
    expect(testingModule.get(RetroGateway)).toBeInstanceOf(RetroGateway);
    expect(testingModule.get(RetroService)).toBeInstanceOf(RetroService);
    expect(testingModule.get(ParticipantService)).toBeInstanceOf(
      ParticipantService,
    );
    expect(testingModule.get(RoomRegistryService)).toBeInstanceOf(
      RoomRegistryService,
    );
    await testingModule.close();
  });

  it('acknowledges only the requesting socket, including rejected commands', () => {
    const owner = socket();
    const guest = socket();
    gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'Retro',
      requestId: 'create-1',
    });
    expect(latest(owner).data.requestId).toBe('create-1');
    gateway.onCommand(guest, {
      type: 'join',
      name: 'Bobby',
      code: latest(owner).data.room.code,
      requestId: 'join-1',
    });
    expect(latest(guest).data.requestId).toBe('join-1');
    expect(latest(owner).data).not.toHaveProperty('requestId');
    gateway.onCommand(guest, { type: 'advance', requestId: 'advance-1' });
    expect(latest(guest)).toMatchObject({
      event: 'retro-error',
      data: { code: 'forbidden', requestId: 'advance-1' },
    });
  });
  it('broadcasts participant-specific private writing then reveals one board', () => {
    const owner = socket();
    const guest = socket();
    gateway.onCommand(owner, { type: 'create', name: 'Alice', title: 'Retro' });
    const code = latest(owner).data.room.code;
    gateway.onCommand(guest, { type: 'join', name: 'Bobby', code });

    gateway.onCommand(owner, {
      type: 'add-note',
      column: 'went-well',
      text: 'Owner thought',
    });
    expect(
      latest(owner).data.room.notes.map(({ text }: { text: string }) => text),
    ).toEqual(['Owner thought']);
    expect(latest(guest).data.room.notes).toEqual([]);

    gateway.onCommand(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Guest thought',
    });
    expect(
      latest(owner).data.room.notes.map(({ text }: { text: string }) => text),
    ).toEqual(['Owner thought']);
    expect(
      latest(guest).data.room.notes.map(({ text }: { text: string }) => text),
    ).toEqual(['Guest thought']);

    gateway.onCommand(owner, { type: 'advance' });
    for (const client of [owner, guest]) {
      expect(latest(client).data.room.phase).toBe('vote');
      expect(
        latest(client).data.room.notes.map(
          ({ text }: { text: string }) => text,
        ),
      ).toEqual(['Owner thought', 'Guest thought']);
    }
  });

  it('expires attached rooms and cleans timers even without incoming messages', () => {
    const owner = socket();
    gateway.onCommand(owner, { type: 'create', name: 'Alice', title: 'Retro' });
    const code = latest(owner).data.room.code;
    gateway.afterInit({ clients: new Set() } as Server);
    gateway.afterInit({ clients: new Set() } as Server);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(RETRO_LIFETIME_MS);
    expect(latest(owner)).toMatchObject({
      event: 'retro-error',
      data: { code: 'room-expired' },
    });
    expect(service.isExpired(code)).toBe(true);
    gateway.onCommand(owner, {
      type: 'create',
      name: 'Alice',
      title: 'New room',
    });
    expect(latest(owner).data.room.code).not.toBe(code);
    gateway.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks disconnects and sends only other members their own credentials', () => {
    const owner = socket();
    const guest = socket();
    gateway.onCommand(owner, { type: 'create', name: 'Alice', title: 'Retro' });
    const created = latest(owner).data;
    gateway.onCommand(guest, {
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    gateway.handleDisconnect(guest);
    expect(latest(owner).data.room.members[1].connected).toBe(false);
    expect(latest(owner).data.self).toEqual(created.self);
    expect(() => gateway.handleDisconnect(guest)).not.toThrow();
  });

  it('limits command floods and recovers after the rate window', () => {
    const owner = socket();
    for (let i = 0; i < 31; i++) gateway.onCommand(owner, null);
    expect(latest(owner).data.code).toBe('rate-limit');
    vi.advanceTimersByTime(1000);
    gateway.onCommand(owner, { type: 'create', name: 'Alice', title: 'Retro' });
    expect(latest(owner).event).toBe('retro-state');
  });

  it('pings clients and terminates unresponsive connections', () => {
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
