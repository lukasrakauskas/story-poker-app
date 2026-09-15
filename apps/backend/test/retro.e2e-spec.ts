import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { WebSocket } from 'ws';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetentionService } from '../src/collaboration/retention.service.js';
import { OriginAllowlistService } from '../src/transport/origin-allowlist.service.js';
import { RETRO_OFFLINE_RETENTION_MS } from '../src/retro/retro.service.js';
import type { RetroCommand, RetroServerEvent } from 'shared/retrospective';
import { AppModule } from '../src/app.module.js';

let app: INestApplication;
let httpUrl: string;
let url: string;
let sockets: WebSocket[];

function next(socket: WebSocket): Promise<RetroServerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket event'));
    }, 3000);
    function onMessage(data: Buffer) {
      const event = JSON.parse(data.toString());
      if (event.event === 'is-alive') return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(event);
    }
    socket.on('message', onMessage);
  });
}
async function connect(path = '/retro', cookie?: string, origin?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const socket = new WebSocket(`${url}${path}`, { headers });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}
async function establish(data: RetroCommand) {
  const response = await request(httpUrl).post('/retro/session').send(data);
  expect(response.status).toBe(201);
  const setCookie = response.headers['set-cookie']?.[0];
  expect(setCookie).toBeTruthy();
  return {
    view: response.body as { room: { code: string }; self: { id: string } },
    cookie: setCookie!.split(';', 1)[0],
  };
}
async function enter(data: Extract<RetroCommand, { type: 'create' | 'join' }>) {
  const established = await establish(data);
  const socket = await connect('/retro', established.cookie);
  const view = state(
    await command(socket, { type: 'resume', code: established.view.room.code }),
  );
  return { socket, cookie: established.cookie, view };
}
async function command(socket: WebSocket, data: RetroCommand | unknown) {
  const response = next(socket);
  socket.send(JSON.stringify({ event: 'retro-command', data }));
  return response;
}
function state(event: RetroServerEvent) {
  if (event.event !== 'retro-state') throw new Error(JSON.stringify(event));
  return event.data;
}

beforeEach(async () => {
  sockets = [];
  const fixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = fixture.createNestApplication();
  const origins = app.get(OriginAllowlistService);
  app.enableCors({
    credentials: true,
    origin: (origin, callback) => origins.corsOrigin(origin, callback),
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0, '127.0.0.1');
  httpUrl = await app.getUrl();
  url = httpUrl.replace('http:', 'ws:');
});
afterEach(async () => {
  sockets.forEach((socket) => socket.terminate());
  await app.close();
  vi.restoreAllMocks();
});

describe('retrospective WebSocket route', () => {
  it('rejects a cross-site WebSocket origin before it can establish a session', async () => {
    const blocked = await new Promise<{ socket: WebSocket; code: number }>(
      (resolve, reject) => {
        const socket = new WebSocket(`${url}/retro`, {
          headers: { Origin: 'https://evil.example' },
        });
        sockets.push(socket);
        socket.once('error', () => undefined);
        const timeout = setTimeout(
          () => reject(new Error('Origin rejection timed out')),
          3000,
        );
        socket.once('close', (code) => {
          clearTimeout(timeout);
          resolve({ socket, code });
        });
      },
    );
    expect(blocked.code).toBe(1008);
  });

  it('applies the exact origin policy to HTTP session establishment', async () => {
    const blocked = await request(httpUrl)
      .post('/retro/session')
      .set('Origin', 'https://evil.example')
      .send({ type: 'create', name: 'Alice', title: 'Blocked' });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'origin-not-allowed' });

    const allowed = await request(httpUrl)
      .post('/retro/session')
      .set('Origin', 'http://localhost:3001')
      .send({ type: 'create', name: 'Alice', title: 'Allowed' });
    expect(allowed.status).toBe(201);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3001',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rotates HTTP credentials, rejects replay, and leaves state token-free', async () => {
    const createdResponse = await request(httpUrl)
      .post('/retro/session')
      .send({ type: 'create', name: 'Alice', title: 'Rotate' });
    expect(createdResponse.status).toBe(201);
    expect(JSON.stringify(createdResponse.body)).not.toContain('token');
    const oldCookie = createdResponse.headers['set-cookie'][0].split(';', 1)[0];
    const code = createdResponse.body.room.code as string;
    const original = await connect('/retro', oldCookie);
    expect(await command(original, { type: 'resume', code })).toMatchObject({
      event: 'retro-state',
      data: { self: { id: expect.any(String) } },
    });

    const displaced = next(original);
    const rotated = await request(httpUrl)
      .post(`/retro/session/${code}/resume`)
      .set('Cookie', oldCookie)
      .send();
    expect(rotated.status).toBe(201);
    expect(JSON.stringify(rotated.body)).not.toContain('token');
    const newCookie = rotated.headers['set-cookie'][0].split(';', 1)[0];
    expect(newCookie).not.toBe(oldCookie);
    expect(await displaced).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });

    const replay = await connect('/retro', oldCookie);
    expect(await command(replay, { type: 'resume', code })).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const active = await connect('/retro', newCookie);
    expect(await command(active, { type: 'resume', code })).toMatchObject({
      event: 'retro-state',
      data: { self: { id: createdResponse.body.self.id } },
    });
  });

  it('broadcasts offline membership expiry and rejects its stale credential', async () => {
    const retention = app.get(RetentionService);
    const schedule = retention.schedule.bind(retention);
    const scheduled = vi
      .spyOn(retention, 'schedule')
      .mockImplementation((namespace, key, delay, expire) =>
        schedule(namespace, key, namespace === 'retro' ? 50 : delay, expire),
      );
    const ownerEntry = await enter({
      type: 'create',
      name: 'Alice',
      title: 'Retention',
    });
    const owner = ownerEntry.socket;
    const guestEntry = await enter({
      type: 'join',
      name: 'Bobby',
      code: ownerEntry.view.room.code,
    });
    const guest = guestEntry.socket;
    const created = ownerEntry.view;
    const joined = guestEntry.view;
    await command(guest, {
      type: 'add-note',
      column: 'ideas',
      text: 'Keep attribution',
    });
    await command(owner, { type: 'advance' });
    const offline = next(owner);
    guest.close();
    expect(
      state(await offline).room.members.find(
        (member) => member.id === joined.self.id,
      )?.connected,
    ).toBe(false);
    const expired = state(await next(owner));
    expect(scheduled).toHaveBeenCalledWith(
      'retro',
      expect.any(String),
      RETRO_OFFLINE_RETENTION_MS,
      expect.any(Function),
    );
    expect(expired.room.members).toHaveLength(1);
    expect(expired.room.notes[0]).toMatchObject({
      text: 'Keep attribution',
      authorName: 'Bobby',
    });
    const returning = await connect('/retro', guestEntry.cookie);
    expect(
      await command(returning, {
        type: 'resume',
        code: created.room.code,
      }),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const replacementEntry = await establish({
      type: 'join',
      code: created.room.code,
      name: 'Bobby',
    });
    const replacement = replacementEntry.view;
    expect(replacement.self.id).not.toBe(joined.self.id);
  });
  it('runs a shared retrospective without leaking credentials or affecting poker', async () => {
    const ownerEntry = await enter({
      type: 'create',
      name: 'Alice',
      title: 'Sprint 1',
    });
    const owner = ownerEntry.socket;
    const ownerJoin = next(owner);
    const guestEntry = await enter({
      type: 'join',
      name: 'Bobby',
      code: ownerEntry.view.room.code,
    });
    const guest = guestEntry.socket;
    const outsider = await connect();
    const created = ownerEntry.view;
    const joined = guestEntry.view;
    expect(created.room.phase).toBe('write');
    expect(JSON.stringify(created.room)).not.toContain('token');
    expect(state(await ownerJoin).room.members).toHaveLength(2);
    expect(JSON.stringify(joined)).not.toContain('token');
    expect(await command(outsider, { type: 'advance' })).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const guestPrivateUpdate = next(guest);
    const withOwnerNote = state(
      await command(owner, {
        type: 'add-note',
        column: 'went-well',
        text: 'Teamwork',
      }),
    );
    expect(state(await guestPrivateUpdate).room.notes).toEqual([]);
    expect(
      await command(guest, {
        type: 'delete-note',
        id: withOwnerNote.room.notes[0].id,
      }),
    ).toMatchObject({ event: 'retro-error', data: { code: 'forbidden' } });

    const ownerPrivateUpdate = next(owner);
    const withGuestNote = state(
      await command(guest, {
        type: 'add-note',
        column: 'improve',
        text: 'Fewer handoffs',
      }),
    );
    expect(withGuestNote.room.notes.map((note) => note.text)).toEqual([
      'Fewer handoffs',
    ]);
    expect(
      state(await ownerPrivateUpdate).room.notes.map((note) => note.text),
    ).toEqual(['Teamwork']);

    const guestReveal = next(guest);
    const revealed = state(await command(owner, { type: 'advance' }));
    expect(revealed.room.notes.map((note) => note.text)).toEqual([
      'Teamwork',
      'Fewer handoffs',
    ]);
    expect(state(await guestReveal).room.notes).toEqual(revealed.room.notes);
    expect(revealed.room.phase).toBe('group');
    const guestGroupedUpdate = next(guest);
    const grouped = state(
      await command(owner, {
        type: 'group-notes',
        title: 'Team flow',
        noteIds: revealed.room.notes.map((note) => note.id),
      }),
    );
    await guestGroupedUpdate;
    const groupId = grouped.room.groups[0].id;
    expect(grouped.room.notes.every((note) => note.groupId === groupId)).toBe(
      true,
    );
    const guestVotingUpdate = next(guest);
    expect(state(await command(owner, { type: 'advance' })).room.phase).toBe(
      'vote',
    );
    await guestVotingUpdate;
    const voteReceived = next(owner);
    const guestVote = state(
      await command(guest, {
        type: 'toggle-vote',
        id: groupId,
      }),
    );
    const ownerVote = state(await voteReceived);
    expect(ownerVote.room.groups[0]).toMatchObject({
      voteCount: null,
      votedBySelf: false,
    });
    expect(guestVote.room.groups[0]).toMatchObject({
      voteCount: null,
      votedBySelf: true,
    });
    expect(JSON.stringify(ownerVote.room)).not.toContain('voterIds');
    expect(JSON.stringify(guestVote.room)).not.toContain('voterIds');
    const discussing = state(await command(owner, { type: 'advance' }));
    expect(discussing.room.groups[0]).toMatchObject({
      voteCount: 1,
      votedBySelf: false,
    });
    const actions = state(
      await command(owner, {
        type: 'add-action',
        text: 'Pair more',
        owner: { kind: 'participant', participantId: joined.self.id },
      }),
    );
    expect(actions.room.actions[0].text).toBe('Pair more');
    expect(state(await command(owner, { type: 'advance' })).room.phase).toBe(
      'closed',
    );
    expect(await command(owner, { type: 'advance' })).toMatchObject({
      event: 'retro-error',
      data: { code: 'room-closed' },
    });
    // The original planning gateway still runs on the root socket route.
    const poker = await connect('');
    const response = next(poker);
    poker.send(
      JSON.stringify({ event: 'create-room', data: { name: 'Planner' } }),
    );
    expect(await response).toMatchObject({
      event: 'room-joined',
      data: { state: 'voting' },
    });
  });

  it('resumes an identity, disconnects its old socket and validates commands', async () => {
    const originalEntry = await enter({
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const original = originalEntry.socket;
    const created = originalEntry.view;
    const displaced = next(original);
    const rotated = await request(httpUrl)
      .post(`/retro/session/${created.room.code}/resume`)
      .set('Cookie', originalEntry.cookie)
      .send();
    expect(rotated.status).toBe(201);
    const replacementCookie = rotated.headers['set-cookie'][0].split(';', 1)[0];
    const replacement = await connect('/retro', replacementCookie);
    const resumed = state(
      await command(replacement, {
        type: 'resume',
        code: created.room.code,
      }),
    );
    expect(resumed.self).toEqual(created.self);
    expect(resumed.room.members).toHaveLength(1);
    expect(await displaced).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    expect(
      await command(replacement, {
        type: 'add-note',
        column: 'ideas',
        text: ' ',
      }),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-command' },
    });
    expect(
      await command(replacement, {
        type: 'create',
        name: 'Alice',
        title: 'Another',
      }),
    ).toMatchObject({ event: 'retro-error', data: { code: 'already-joined' } });

    const targetEntry = await establish({
      type: 'join',
      name: 'Bobby',
      code: created.room.code,
    });
    const target = await connect('/retro', targetEntry.cookie);
    const ownerJoinedUpdate = next(replacement);
    const targetSession = state(
      await command(target, {
        type: 'resume',
        code: created.room.code,
      }),
    );
    await ownerJoinedUpdate;
    const removalNotice = next(target);
    const targetClosed = new Promise<number>((resolve) =>
      target.once('close', resolve),
    );
    const afterRemoval = state(
      await command(replacement, {
        type: 'remove-member',
        memberId: targetSession.self.id,
      }),
    );
    expect(await removalNotice).toMatchObject({
      event: 'retro-error',
      data: { code: 'removed' },
    });
    expect(await targetClosed).toBe(4003);
    expect(afterRemoval.room.members).toHaveLength(1);

    expect(
      state(await command(replacement, { type: 'advance' })).room.members[0]
        .connected,
    ).toBe(true);
  });
});
