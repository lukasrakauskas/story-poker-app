import { materializeRetroState } from 'shared/retrospective';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETRO_OFFLINE_RETENTION_MS } from '../src/retro/retro.service.js';
import { RetroApplicationService } from '../src/retro/retro-application.service.js';
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

async function connect(cookie?: string, path = '/retro') {
  const socket = new WebSocket(`${url}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function command(socket: WebSocket, data: RetroCommand | unknown) {
  const response = next(socket);
  socket.send(JSON.stringify({ event: 'retro-command', data }));
  return response;
}

function state(event: RetroServerEvent) {
  if (event.event !== 'retro-state') throw new Error(JSON.stringify(event));
  return { ...event.data, room: materializeRetroState(event.data) };
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('Missing session cookie');
  return value.split(';', 1)[0];
}

async function establishHttp(
  commandData: Extract<RetroCommand, { type: 'create' | 'join' }>,
  cookie?: string,
): Promise<BrowserSession> {
  const http = request(app.getHttpServer())
    .post('/retro/session')
    .send(commandData);
  if (cookie) http.set('Cookie', cookie);
  const response = await http.expect(201);
  return { ...response.body, cookie: cookieFrom(response) } as BrowserSession;
}

async function attach(session: BrowserSession) {
  const socket = await connect(session.cookie);
  const initial = state(
    await command(socket, { type: 'resume', code: session.room.code }),
  );
  return { socket, initial };
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
  vi.restoreAllMocks();
});

describe('retrospective HTTP session and WebSocket route', () => {
  it('broadcasts offline membership expiry and rejects its stale credential', async () => {
    const ownerSession = await establishHttp({
      type: 'create',
      name: 'Alice',
      title: 'Retention',
    });
    const guestSession = await establishHttp({
      type: 'join',
      name: 'Bobby',
      code: ownerSession.room.code,
    });
    const owner = await attach(ownerSession);
    const guest = await attach(guestSession);
    await command(guest.socket, {
      type: 'add-note',
      column: 'ideas',
      text: 'Keep attribution',
    });
    await command(owner.socket, { type: 'advance' });
    const offline = next(owner.socket);
    guest.socket.close();
    expect(
      state(await offline).room.members.find(
        (member) => member.id === guestSession.self.id,
      )?.connected,
    ).toBe(false);
    const expiryTime = Date.now() + RETRO_OFFLINE_RETENTION_MS;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiryTime);
    const expiredEvent = next(owner.socket);
    await app.get(RetroApplicationService).expireRooms();
    const expired = state(await expiredEvent);
    clock.mockRestore();
    expect(expired.room.members).toHaveLength(1);
    expect(expired.room.notes[0]).toMatchObject({
      text: 'Keep attribution',
      authorName: 'Bobby',
    });

    const returning = await connect(guestSession.cookie);
    expect(
      await command(returning, {
        type: 'resume',
        code: ownerSession.room.code,
      }),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const replacementSession = await establishHttp({
      type: 'join',
      code: ownerSession.room.code,
      name: 'Bobby',
    });
    const replacement = await attach(replacementSession);
    expect(replacement.initial.self.id).not.toBe(guestSession.self.id);
  });

  it('runs a shared retrospective without leaking credentials or affecting poker', async () => {
    const ownerSession = await establishHttp({
      type: 'create',
      name: 'Alice',
      title: 'Sprint 1',
    });
    const guestSession = await establishHttp({
      type: 'join',
      name: 'Bobby',
      code: ownerSession.room.code,
    });
    const owner = await attach(ownerSession);
    const outsider = await connect();
    const ownerJoin = next(owner.socket);
    const guest = await attach(guestSession);
    expect(state(await ownerJoin).room.members).toHaveLength(2);
    expect(JSON.stringify(guest.initial)).not.toContain('token');
    expect(await command(outsider, { type: 'advance' })).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const guestPrivateUpdate = next(guest.socket);
    const withOwnerNote = state(
      await command(owner.socket, {
        type: 'add-note',
        column: 'went-well',
        text: 'Teamwork',
      }),
    );
    expect(state(await guestPrivateUpdate).room.notes).toEqual([]);
    expect(
      await command(guest.socket, {
        type: 'delete-note',
        id: withOwnerNote.room.notes[0].id,
      }),
    ).toMatchObject({ event: 'retro-error', data: { code: 'forbidden' } });

    const ownerPrivateUpdate = next(owner.socket);
    const withGuestNote = state(
      await command(guest.socket, {
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

    const guestReveal = next(guest.socket);
    const revealed = state(await command(owner.socket, { type: 'advance' }));
    expect(revealed.room.notes.map((note) => note.text)).toEqual([
      'Teamwork',
      'Fewer handoffs',
    ]);
    expect(state(await guestReveal).room.notes).toEqual(revealed.room.notes);
    expect(revealed.room.phase).toBe('group');
    const guestGroupedUpdate = next(guest.socket);
    const grouped = state(
      await command(owner.socket, {
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
    const guestVotingUpdate = next(guest.socket);
    expect(
      state(await command(owner.socket, { type: 'advance' })).room.phase,
    ).toBe('vote');
    await guestVotingUpdate;
    const voteReceived = next(owner.socket);
    const guestVote = state(
      await command(guest.socket, {
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
    const discussing = state(await command(owner.socket, { type: 'advance' }));
    expect(discussing.room.groups[0]).toMatchObject({
      voteCount: 1,
      votedBySelf: false,
    });
    const actions = state(
      await command(owner.socket, {
        type: 'add-action',
        text: 'Pair more',
        owner: { kind: 'participant', participantId: guestSession.self.id },
      }),
    );
    expect(actions.room.actions[0].text).toBe('Pair more');
    expect(
      state(await command(owner.socket, { type: 'advance' })).room.phase,
    ).toBe('closed');
    expect(await command(owner.socket, { type: 'advance' })).toMatchObject({
      event: 'retro-error',
      data: { code: 'room-closed' },
    });
    // The original planning gateway still runs on the root socket route.
    const poker = await connect('', '');
    const response = next(poker);
    poker.send(
      JSON.stringify({ event: 'create-room', data: { name: 'Planner' } }),
    );
    expect(await response).toMatchObject({
      event: 'room-joined',
      data: { state: 'voting' },
    });
  });

  it('rotates an identity through HTTP, displaces its old socket, and validates commands', async () => {
    const originalSession = await establishHttp({
      type: 'create',
      name: 'Alice',
      title: 'Retro',
    });
    const original = await attach(originalSession);
    const displaced = next(original.socket);
    const replacementSession = await request(app.getHttpServer())
      .post(`/retro/session/${originalSession.room.code}/resume`)
      .set('Cookie', originalSession.cookie)
      .expect(201);
    const replacementCookie = cookieFrom(replacementSession);
    const replacementView = replacementSession.body as RetroSessionView;
    expect(replacementView.self).toEqual(originalSession.self);
    expect(await displaced).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const replacement = await attach({
      ...replacementView,
      cookie: replacementCookie,
    });
    expect(replacement.initial.self).toEqual(originalSession.self);
    expect(
      await command(replacement.socket, {
        type: 'add-note',
        column: 'ideas',
        text: ' ',
      }),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-command' },
    });
    expect(
      await command(replacement.socket, {
        type: 'create',
        name: 'Alice',
        title: 'Another',
      }),
    ).toMatchObject({ event: 'retro-error', data: { code: 'already-joined' } });

    const targetSession = await establishHttp({
      type: 'join',
      name: 'Bobby',
      code: originalSession.room.code,
    });
    const ownerJoinedUpdate = next(replacement.socket);
    const target = await attach(targetSession);
    await ownerJoinedUpdate;
    const removalNotice = next(target.socket);
    const targetClosed = new Promise<number>((resolve) =>
      target.socket.once('close', (code) => resolve(code)),
    );
    const afterRemoval = state(
      await command(replacement.socket, {
        type: 'remove-member',
        memberId: target.initial.self.id,
      }),
    );
    expect(await removalNotice).toMatchObject({
      event: 'retro-error',
      data: { code: 'removed' },
    });
    expect(await targetClosed).toBe(4003);
    expect(afterRemoval.room.members).toHaveLength(1);

    expect(
      state(await command(replacement.socket, { type: 'advance' })).room
        .members[0].connected,
    ).toBe(true);
  });
});
