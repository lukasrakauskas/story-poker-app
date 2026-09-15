import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  RetroCommand,
  RetroServerEvent,
  RetroSessionView,
} from 'shared/retrospective';
import { AppModule } from '../src/app.module.js';

type BrowserSession = RetroSessionView & { cookie: string };
let app: INestApplication;
let url: string;
let sockets: WebSocket[];

function waitForEvent(socket: WebSocket): Promise<RetroServerEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), 2_000);
    const onMessage = (data: Buffer) => finish(JSON.parse(data.toString()));
    const onClose = () => finish(null);
    function finish(event: RetroServerEvent | null) {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      resolve(event);
    }
    socket.on('message', onMessage);
    socket.once('close', onClose);
  });
}

async function openSocket(cookie?: string): Promise<WebSocket | null> {
  const socket = new WebSocket(`${url}/retro`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
  sockets.push(socket);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      socket.off('error', onError);
      socket.off('close', onClose);
      resolve(opened ? socket : null);
    };
    const onError = () => finish(false);
    const onClose = () => finish(false);
    socket.once('open', () => finish(true));
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function command(
  socket: WebSocket,
  data: RetroCommand | Record<string, unknown>,
): Promise<RetroServerEvent | null> {
  const event = waitForEvent(socket);
  try {
    socket.send(JSON.stringify({ event: 'retro-command', data }));
  } catch {
    return null;
  }
  return event;
}

async function openAndCommand(
  data: RetroCommand | Record<string, unknown>,
): Promise<RetroServerEvent | null> {
  const socket = await openSocket();
  return socket ? command(socket, data) : null;
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('Missing session cookie');
  return value.split(';', 1)[0];
}

async function establish(
  commandData: Extract<RetroCommand, { type: 'create' | 'join' }>,
): Promise<BrowserSession> {
  const response = await request(app.getHttpServer())
    .post('/retro/session')
    .send(commandData)
    .expect(201);
  return { ...response.body, cookie: cookieFrom(response) } as BrowserSession;
}

beforeEach(async () => {
  sockets = [];
  const fixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = fixture.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('http:', 'ws:');
});

afterEach(async () => {
  sockets.forEach((socket) => socket.terminate());
  await app.close();
});

describe('retrospective admission controls', () => {
  it('keeps an existing room usable while fresh sockets contend for its capacity', async () => {
    const ownerSession = await establish({
      type: 'create',
      name: 'Alice',
      title: 'Admission test',
    });
    const owner = await openSocket(ownerSession.cookie);
    expect(owner).not.toBeNull();
    if (!owner) return;
    const created = await command(owner, {
      type: 'resume',
      code: ownerSession.room.code,
    });
    expect(created).toMatchObject({ event: 'retro-state' });
    if (!created || created.event !== 'retro-state') return;

    const attempts = await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        openAndCommand({
          type: 'join',
          code: created.data.room.code,
          name: `Fresh ${index}`,
        }),
      ),
    );
    const responses = attempts.filter(
      (event): event is RetroServerEvent => event !== null,
    );
    const joined = responses.filter((event) => event.event === 'retro-state');
    const throttled = responses.filter(
      (event) =>
        event.event === 'retro-error' && event.data.code === 'rate-limit',
    );
    const rejectedConnections = attempts.length - responses.length;
    expect(rejectedConnections).toBeGreaterThan(0);
    expect(throttled.length).toBeGreaterThan(0);
    expect(joined.length).toBe(0);

    const ownerUpdate = await command(owner, {
      type: 'add-note',
      column: 'ideas',
      text: 'Existing room remains writable',
    });
    expect(ownerUpdate).toMatchObject({
      event: 'retro-state',
      data: {
        room: {
          members: expect.arrayContaining([
            expect.objectContaining({ name: 'Alice' }),
          ]),
        },
        recipient: {
          notes: [
            expect.objectContaining({ text: 'Existing room remains writable' }),
          ],
        },
      },
    });
    if (ownerUpdate?.event === 'retro-state')
      expect(ownerUpdate.data.room.members.length).toBe(1);
  });

  it('does not reset source create throttling when every attempt uses a new socket', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        openAndCommand({
          type: 'create',
          name: `Creator ${index}`,
          title: `Room ${index}`,
        }),
      ),
    );
    const states = attempts.filter(
      (event): event is RetroServerEvent => event?.event === 'retro-state',
    );
    const throttled = attempts.filter(
      (event) =>
        event?.event === 'retro-error' && event.data.code === 'rate-limit',
    );
    expect(states.length).toBe(0);
    expect(throttled.length).toBeGreaterThanOrEqual(5);
  });
});
