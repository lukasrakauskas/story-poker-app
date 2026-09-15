import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETRO_OFFLINE_RETENTION_MS } from '../src/retro/retro.service.js';
import { RetroApplicationService } from '../src/retro/retro-application.service.js';
import type { RetroCommand, RetroServerEvent } from 'shared/retrospective';
import { AppModule } from '../src/app.module.js';

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
async function connect(path = '/retro') {
  const socket = new WebSocket(`${url}${path}`);
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
  return event.data;
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

describe('retrospective WebSocket route', () => {
  it('broadcasts offline membership expiry and rejects its stale credential', async () => {
    const owner = await connect();
    const guest = await connect();
    const created = state(
      await command(owner, {
        type: 'create',
        name: 'Alice',
        title: 'Retention',
      }),
    );
    const joined = state(
      await command(guest, {
        type: 'join',
        name: 'Bobby',
        code: created.room.code,
      }),
    );
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
    const expiryTime = Date.now() + RETRO_OFFLINE_RETENTION_MS;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiryTime);
    const expiredEvent = next(owner);
    await app.get(RetroApplicationService).expireRooms();
    const expired = state(await expiredEvent);
    clock.mockRestore();
    expect(expired.room.members).toHaveLength(1);
    expect(expired.room.notes[0]).toMatchObject({
      text: 'Keep attribution',
      authorName: 'Bobby',
    });
    const returning = await connect();
    expect(
      await command(returning, {
        type: 'resume',
        code: created.room.code,
        token: joined.self.token,
      }),
    ).toMatchObject({
      event: 'retro-error',
      data: { code: 'invalid-session' },
    });
    const replacement = state(
      await command(returning, {
        type: 'join',
        code: created.room.code,
        name: 'Bobby',
      }),
    );
    expect(replacement.self.id).not.toBe(joined.self.id);
  });
  it('runs a shared retrospective without leaking credentials or affecting poker', async () => {
    const owner = await connect();
    const guest = await connect();
    const outsider = await connect();
    const created = state(
      await command(owner, {
        type: 'create',
        name: 'Alice',
        title: 'Sprint 1',
      }),
    );
    expect(created.room.phase).toBe('write');
    expect(JSON.stringify(created.room)).not.toContain('token');
    const ownerJoin = next(owner);
    const joined = state(
      await command(guest, {
        type: 'join',
        name: 'Bobby',
        code: created.room.code,
      }),
    );
    expect(state(await ownerJoin).room.members).toHaveLength(2);
    expect(joined.self.token).not.toBe(created.self.token);
    expect(JSON.stringify(joined)).not.toContain(created.self.token);
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
    const original = await connect();
    const created = state(
      await command(original, {
        type: 'create',
        name: 'Alice',
        title: 'Retro',
      }),
    );
    const replacement = await connect();
    const displaced = next(original);
    const resumed = state(
      await command(replacement, {
        type: 'resume',
        code: created.room.code,
        token: created.self.token,
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

    const target = await connect();
    const ownerJoinedUpdate = next(replacement);
    const targetSession = state(
      await command(target, {
        type: 'join',
        name: 'Bobby',
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
