import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type {
  RetroCommand,
  RetroRememberedIdentity,
  RetroRoom,
  RetroSessionView,
} from "shared/retrospective";
import {
  createRetroSessionClient,
  type RetroHistoryStorage,
  type RetroSessionApi,
  type RetroSessionClient,
  type RetroTimerStorage,
  type RetroTransport,
} from "../lib/retro-session-client";
import type {
  WebSocketTransportEvent,
  WebSocketTransportEventMap,
} from "../lib/websocket-transport";
import { createRetroReconnectPolicy } from "../lib/retro-reconnect-policy";
import { parseRetroRoomCode } from "../lib/retro-route";

class FakeTimers implements RetroTimerStorage {
  nowValue = 1_700_000_000_000;
  private nextId = 0;
  private readonly timeouts = new Map<
    number,
    { due: number; callback: () => void }
  >();

  setTimeout(callback: () => void, delay: number) {
    const id = ++this.nextId;
    this.timeouts.set(id, { due: this.nowValue + delay, callback });
    return id;
  }

  clearTimeout(handle: unknown) {
    this.timeouts.delete(handle as number);
  }

  advance(milliseconds: number) {
    const target = this.nowValue + milliseconds;
    while (true) {
      const next = [...this.timeouts.entries()]
        .filter(([, timeout]) => timeout.due <= target)
        .sort(([, left], [, right]) => left.due - right.due)[0];
      if (!next) break;
      const [id, timeout] = next;
      this.timeouts.delete(id);
      this.nowValue = timeout.due;
      timeout.callback();
    }
    this.nowValue = target;
  }

  get timeoutCount() {
    return this.timeouts.size;
  }
}

class FakeTransport implements RetroTransport {
  open = false;
  connectCalls = 0;
  reconnectCalls = 0;
  closeCalls = 0;
  disposeCalls = 0;
  sent: string[] = [];
  private readonly listeners = new Map<
    WebSocketTransportEvent,
    Set<(value: never) => void>
  >();

  connect() {
    this.connectCalls++;
    return true;
  }

  reconnect() {
    this.reconnectCalls++;
    this.open = false;
    return true;
  }

  send(data: string) {
    if (!this.open) return false;
    this.sent.push(data);
    return true;
  }

  close() {
    this.closeCalls++;
    this.open = false;
  }

  dispose() {
    this.disposeCalls++;
    this.close();
    this.listeners.clear();
  }

  isOpen() {
    return this.open;
  }

  on<K extends WebSocketTransportEvent>(
    event: K,
    listener: (value: WebSocketTransportEventMap[K]) => void
  ) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener as unknown as (value: never) => void);
    this.listeners.set(event, listeners);
    return () =>
      listeners.delete(listener as unknown as (value: never) => void);
  }

  emit<K extends WebSocketTransportEvent>(
    event: K,
    value: WebSocketTransportEventMap[K]
  ) {
    for (const listener of this.listeners.get(event) ?? [])
      listener(value as never);
  }

  openSocket() {
    this.open = true;
    this.emit("open", {} as Event);
  }

  closeFromPeer() {
    this.open = false;
    this.emit("close", { code: 1006 } as CloseEvent);
  }

  message(value: unknown) {
    this.emit("message", { data: value } as MessageEvent);
  }

  lastCommand() {
    return JSON.parse(this.sent.at(-1)!);
  }
}

const room: RetroRoom = {
  code: "retro-room",
  title: "Sprint retrospective",
  phase: "write",
  expiresAt: 1_700_000_600_000,
  closedAt: null,
  members: [
    {
      id: "alice",
      name: "Alice",
      moderator: true,
      connected: true,
      ready: false,
    },
  ],
  notes: [],
  actions: [],
  requiresPassword: false,
};

const view: RetroSessionView = { room, self: { id: "alice" } };
const identity: RetroRememberedIdentity = {
  code: "retro-room",
  name: "Alice",
  moderator: true,
};

function stateEvent(
  snapshot: RetroRoom = room,
  requestId?: string,
  version = 1
) {
  return JSON.stringify({
    event: "retro-state",
    data: {
      room: snapshot,
      self: { id: "alice" },
      version,
      recipient: {
        notes: snapshot.phase === "write" ? snapshot.notes : [],
        votedNoteIds: [],
      },
      ...(requestId === undefined ? {} : { requestId }),
    },
  });
}

class FakeSessions implements RetroSessionApi {
  readonly calls: {
    operation: string;
    code?: string;
    command?: RetroCommand;
  }[] = [];
  inspectResult: RetroRememberedIdentity | null = identity;
  inspectFailure: { code: string; message: string } | null = null;
  resumeFailure: { code: string; message: string } | null = null;
  forgetFailure: { code: string; message: string } | null = null;

  establish(command: Extract<RetroCommand, { type: "create" | "join" }>) {
    this.calls.push({ operation: "establish", command });
    return Promise.resolve(view);
  }

  inspect(code: string) {
    this.calls.push({ operation: "inspect", code });
    if (this.inspectFailure) return Promise.reject(this.inspectFailure);
    if (!this.inspectResult)
      return Promise.reject({ code: "session-required", message: "none" });
    return Promise.resolve(this.inspectResult);
  }

  resume(code: string) {
    this.calls.push({ operation: "resume", code });
    if (this.resumeFailure) return Promise.reject(this.resumeFailure);
    return Promise.resolve(view);
  }

  forget(code: string) {
    this.calls.push({ operation: "forget", code });
    if (this.forgetFailure) return Promise.reject(this.forgetFailure);
    return Promise.resolve(true);
  }
}

class FakeHistory implements RetroHistoryStorage {
  readonly saved: { room: RetroRoom; viewerId: string }[] = [];

  save(roomValue: RetroRoom, viewerId: string) {
    this.saved.push({ room: roomValue, viewerId });
    return true;
  }
}

function setup(initialCode?: string) {
  const transport = new FakeTransport();
  const sessions = new FakeSessions();
  const history = new FakeHistory();
  const timers = new FakeTimers();
  const client = createRetroSessionClient({
    transport,
    initialCode,
    sessions,
    history,
    clock: { now: () => timers.nowValue },
    timers,
    navigation: { replaceRoom: () => undefined },
    connectionTimeoutMs: 100,
    requestTimeoutMs: 100,
    reconnectPolicy: createRetroReconnectPolicy({
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      jitterRatio: 0,
    }),
  });
  client.start();
  return { client, transport, sessions, history, timers };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

let clients: RetroSessionClient[] = [];
beforeEach(() => {
  clients = [];
});
afterEach(() => {
  for (const client of clients) client.dispose();
});

test("correlates room inspection and exposes only access metadata", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();

  const pending = context.client.send({ type: "inspect", code: "retro-room" });
  assert.deepEqual(context.transport.lastCommand().data, {
    type: "inspect",
    code: "retro-room",
    requestId: "1",
  });
  context.transport.message(
    JSON.stringify({
      event: "retro-room-info",
      data: {
        code: "retro-room",
        available: true,
        requiresPassword: true,
        requestId: "1",
      },
    })
  );

  assert.equal(await pending, true);
  assert.deepEqual(context.client.getSnapshot().roomInfo, {
    code: "retro-room",
    available: true,
    requiresPassword: true,
  });
});

test("checks an HttpOnly remembered session without auto-resuming it", async () => {
  const context = setup("retro-room");
  clients.push(context.client);
  context.transport.openSocket();
  await flush();

  assert.equal(context.client.getSnapshot().phase, "anonymous");
  assert.equal(context.client.getSnapshot().rememberedIdentity?.name, "Alice");
  assert.equal(
    context.transport.sent.some(
      (value) => JSON.parse(value).data.type === "resume"
    ),
    false
  );
  assert.deepEqual(
    context.sessions.calls.map((call) => call.operation),
    ["inspect"]
  );
});

test("rotates through HTTP before sending a token-free WebSocket resume", async () => {
  const context = setup("retro-room");
  clients.push(context.client);
  context.transport.openSocket();
  await flush();

  const pending = context.client.continueRememberedSession("retro-room");
  await flush();
  context.transport.openSocket();
  await flush();
  assert.deepEqual(context.transport.lastCommand().data, {
    type: "resume",
    code: "retro-room",
    requestId: "1",
  });
  assert.equal("token" in context.transport.lastCommand().data, false);
  context.transport.message(stateEvent(room, "1"));
  assert.equal(await pending, true);
  assert.equal(context.client.getSnapshot().phase, "active");
  assert.equal(
    context.sessions.calls.filter((call) => call.operation === "resume").length,
    1
  );
});

test("does not replay an unconfirmed mutation after timeout and reconnects only after HTTP resume", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());

  const mutation = context.client.send({
    type: "add-note",
    column: "ideas",
    text: "Avoid replaying this change",
  });
  const mutationPayload = context.transport.lastCommand();
  context.timers.advance(100);
  assert.equal(await mutation, false);
  assert.equal(context.client.getSnapshot().connection, "disconnected");

  context.client.retry();
  context.transport.openSocket();
  await flush();
  context.transport.openSocket();
  await flush();
  const resumePayload = context.transport.lastCommand();
  assert.equal(resumePayload.data.type, "resume");
  assert.equal("token" in resumePayload.data, false);
  assert.notEqual(resumePayload.data, mutationPayload.data);
  assert.equal(
    context.transport.sent.filter(
      (value) => JSON.parse(value).data.type === "add-note"
    ).length,
    1
  );
});

test("requires the matching request id before acknowledging a mutation", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());

  const mutation = context.client.send({ type: "toggle-ready" });
  const requestId = context.transport.lastCommand().data.requestId;
  context.transport.message(
    stateEvent(
      { ...room, members: [{ ...room.members[0], ready: true }] },
      "other-request"
    )
  );
  assert.equal(context.client.getSnapshot().pendingRequestId, requestId);
  context.transport.message(
    stateEvent(
      { ...room, members: [{ ...room.members[0], ready: true }] },
      requestId
    )
  );
  assert.equal(await mutation, true);
});

test("sends and receives ephemeral arrange presence without pending requests", () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  const arranging = { ...room, phase: "group" as const };
  context.transport.message(stateEvent(arranging));

  assert.equal(
    context.client.sendPresence({
      x: 0.25,
      y: 0.75,
      noteId: "note",
      active: true,
    }),
    true
  );
  assert.deepEqual(context.transport.lastCommand(), {
    event: "retro-presence",
    data: { x: 0.25, y: 0.75, noteId: "note", active: true },
  });
  assert.equal(context.client.getSnapshot().pendingRequestId, null);

  context.transport.message(
    JSON.stringify({
      event: "retro-presence",
      data: {
        memberId: "bob",
        x: 0.5,
        y: 0.4,
        noteId: "note",
        active: true,
      },
    })
  );
  assert.equal(context.client.getSnapshot().presence.bob?.x, 0.5);
  context.transport.message(
    JSON.stringify({
      event: "retro-presence",
      data: {
        memberId: "bob",
        x: 0,
        y: 0,
        noteId: null,
        active: false,
      },
    })
  );
  assert.deepEqual(context.client.getSnapshot().presence, {});
});

test("rejects malformed nested state and closes the transport", () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(
    stateEvent({ ...room, members: [{ id: "alice" } as never] })
  );

  assert.equal(context.client.getSnapshot().connection, "disconnected");
  assert.equal(context.client.getSnapshot().error?.code, "connection");
  assert.equal(context.client.getSnapshot().room, null);
  assert.equal(context.transport.closeCalls, 1);
});

test("keeps an actively replaced session terminal without JavaScript cookie deletion", () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());
  context.transport.message(
    JSON.stringify({
      event: "retro-error",
      data: {
        code: "invalid-session",
        message: "Your session was resumed in another connection.",
      },
    })
  );

  const snapshot = context.client.getSnapshot();
  assert.equal(snapshot.connection, "disconnected");
  assert.equal(snapshot.phase, "terminal");
  assert.equal(snapshot.selfId, null);
  assert.deepEqual(snapshot.room, room);
  context.client.retry();
  assert.equal(context.transport.reconnectCalls, 0);
});

test("forget uses the HTTP identity endpoint and clears only remembered state", async () => {
  const context = setup("retro-room");
  clients.push(context.client);
  context.transport.openSocket();
  await flush();
  assert.equal(
    await context.client.forgetRememberedSession("retro-room"),
    true
  );
  assert.equal(context.client.getSnapshot().rememberedIdentity, null);
  assert.equal(context.client.getSnapshot().rememberedStatus, "forgotten");
  assert.deepEqual(
    context.sessions.calls
      .filter((call) => call.operation === "forget")
      .map((call) => call.code),
    ["retro-room"]
  );
});

test("replaces a possibly stale socket when a room returns to the foreground", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());

  context.client.setEnvironment(true, false);
  assert.equal(context.client.getSnapshot().connection, "connected");
  context.client.setEnvironment(true, true);
  assert.equal(context.client.getSnapshot().phase, "resuming");
  assert.equal(context.transport.isOpen(), false);
  assert.equal(context.transport.closeCalls, 1);

  await flush();
  assert.equal(
    context.sessions.calls.filter((call) => call.operation === "resume").length,
    1
  );
  context.transport.openSocket();
  const resume = context.transport.lastCommand();
  assert.equal(resume.data.type, "resume");
  context.transport.message(stateEvent(room, resume.data.requestId));
  assert.equal(context.client.getSnapshot().connection, "connected");
  assert.equal(context.client.getSnapshot().selfId, "alice");
});

test("bounds automatic recovery and leaves manual retry available", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());
  context.sessions.resumeFailure = {
    code: "connection",
    message: "Offline server",
  };
  context.transport.closeFromPeer();
  for (let i = 0; i < 6; i++) {
    context.timers.advance(1000);
    await flush();
  }
  assert.equal(context.client.getSnapshot().recovery, "exhausted");
  assert.equal(
    context.sessions.calls.filter((call) => call.operation === "resume").length,
    6
  );
  context.timers.advance(60000);
  assert.equal(
    context.sessions.calls.filter((call) => call.operation === "resume").length,
    6
  );
  context.client.retry();
  await flush();
  assert.equal(
    context.sessions.calls.filter((call) => call.operation === "resume").length,
    7
  );
});

test("ignores HTTP establishment completing after timeout or disposal", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  let resolve!: (value: RetroSessionView) => void;
  context.sessions.establish = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = context.client.send({
    type: "create",
    name: "Alice",
    title: "Late response",
  });
  context.timers.advance(100);
  assert.equal(await pending, false);
  resolve(view);
  await flush();
  assert.equal(context.transport.reconnectCalls, 0);
  assert.equal(context.client.getSnapshot().room, null);
  context.client.dispose();
  assert.equal(context.timers.timeoutCount, 0);
});

test("refreshes missed versions without replaying mutations or discarding matching ACKs", async () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());
  context.transport.message(
    stateEvent({ ...room, title: "Latest" }, undefined, 3)
  );
  assert.equal(context.transport.lastCommand().data.type, "refresh");
  const refreshId = context.transport.lastCommand().data.requestId;
  context.transport.message(
    stateEvent({ ...room, title: "Latest" }, refreshId, 3)
  );
  assert.equal(context.client.getSnapshot().room?.title, "Latest");
  const mutation = context.client.send({ type: "toggle-ready" });
  const id = context.transport.lastCommand().data.requestId;
  // A request-specific authoritative full snapshot can cross a gap safely.
  context.transport.message(
    stateEvent({ ...room, title: "Acknowledged" }, id, 5)
  );
  assert.equal(await mutation, true);
  context.transport.message(stateEvent(room, undefined, 4));
  assert.equal(context.client.getSnapshot().room?.title, "Acknowledged");
  assert.equal(
    context.transport.sent.filter(
      (value) => JSON.parse(value).data.type === "toggle-ready"
    ).length,
    1
  );
});

test("keeps route parsing independent from the transport", () => {
  assert.equal(parseRetroRoomCode("/retro/retro-room"), "retro-room");
  assert.equal(parseRetroRoomCode("/retro/retro-room/"), "retro-room");
  assert.equal(parseRetroRoomCode("/retro/has%2Fslash"), null);
  assert.equal(parseRetroRoomCode("/retro"), null);
});
