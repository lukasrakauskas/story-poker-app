import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { RetroRoom } from "shared/retrospective";
import {
  createRetroSessionClient,
  type RetroCredentialStorage,
  type RetroHistoryStorage,
  type RetroSessionClient,
  type RetroTimerStorage,
  type RetroTransport,
} from "../lib/retro-session-client";
import type {
  WebSocketTransportEvent,
  WebSocketTransportEventMap,
} from "../lib/websocket-transport";
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
  connected = false;
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
    this.connected = true;
    return true;
  }

  reconnect() {
    this.reconnectCalls++;
    this.connected = true;
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
    this.connected = false;
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
    this.connected = false;
    this.emit("close", { code: 1006 } as CloseEvent);
  }

  message(value: unknown) {
    this.emit("message", { data: value } as MessageEvent);
  }

  lastCommand() {
    return JSON.parse(this.sent.at(-1)!);
  }
}

class FakeCredentials implements RetroCredentialStorage {
  readonly values = new Map<string, string>();
  readonly saved: { code: string; token: string; expiresAt: number }[] = [];
  readonly cleared: string[] = [];
  throwOnSave = false;

  read(code: string) {
    return this.values.get(code) ?? null;
  }

  save(code: string, token: string, expiresAt: number) {
    if (this.throwOnSave) throw new Error("storage blocked");
    this.saved.push({ code, token, expiresAt });
    this.values.set(code, token);
    return true;
  }

  clear(code: string) {
    this.cleared.push(code);
    this.values.delete(code);
  }
}

class FakeHistory implements RetroHistoryStorage {
  readonly saved: { room: RetroRoom; viewerId: string }[] = [];
  throwOnSave = false;

  save(room: RetroRoom, viewerId: string) {
    if (this.throwOnSave) throw new Error("quota exceeded");
    this.saved.push({ room, viewerId });
    return true;
  }
}

class FakeNavigation {
  readonly codes: string[] = [];
  throwOnReplace = false;

  replaceRoom(code: string) {
    if (this.throwOnReplace) throw new Error("history unavailable");
    this.codes.push(code);
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
  groups: [],
  actions: [],
  requiresPassword: false,
};

function stateEvent(
  snapshot: RetroRoom = room,
  requestId?: string,
  token = "token-alice"
) {
  return JSON.stringify({
    event: "retro-state",
    data: {
      room: snapshot,
      self: { id: "alice", token },
      ...(requestId === undefined ? {} : { requestId }),
    },
  });
}

function setup(initialCode?: string, initialToken?: string) {
  const transport = new FakeTransport();
  const credentials = new FakeCredentials();
  if (initialCode && initialToken)
    credentials.values.set(initialCode, initialToken);
  const history = new FakeHistory();
  const navigation = new FakeNavigation();
  const timers = new FakeTimers();
  const client = createRetroSessionClient({
    transport,
    initialCode,
    credentials,
    history,
    clock: { now: () => timers.nowValue },
    timers,
    navigation,
    connectionTimeoutMs: 100,
    requestTimeoutMs: 100,
  });
  client.start();
  return { client, transport, credentials, history, navigation, timers };
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

test("resumes a cookie session with a correlated request and saves the snapshot", () => {
  const context = setup("retro-room", "cookie-token");
  clients.push(context.client);
  context.transport.openSocket();

  assert.equal(context.client.getSnapshot().phase, "resuming");
  assert.equal(context.client.getSnapshot().pendingRequestId, "1");
  assert.deepEqual(context.transport.lastCommand().data, {
    type: "resume",
    code: "retro-room",
    token: "cookie-token",
    requestId: "1",
  });
  context.transport.message(stateEvent(room, "1"));

  assert.equal(context.client.getSnapshot().phase, "active");
  assert.equal(context.client.getSnapshot().connection, "connected");
  assert.equal(context.client.getSnapshot().selfId, "alice");
  assert.equal(context.client.getSnapshot().pendingRequestId, null);
  assert.equal(context.credentials.saved[0].token, "token-alice");
  assert.equal(context.history.saved[0].viewerId, "alice");
  assert.deepEqual(context.navigation.codes, ["retro-room"]);
});

test("does not replay an unconfirmed mutation after timeout and reconnects only by resuming", async () => {
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
  assert.equal(context.client.getSnapshot().error?.code, "timeout");

  context.client.retry();
  assert.equal(context.client.getSnapshot().connection, "connecting");
  context.transport.openSocket();
  const resumePayload = context.transport.lastCommand();
  assert.equal(resumePayload.data.type, "resume");
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

  const mutation = context.client.send({
    type: "toggle-ready",
  });
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
  assert.equal(context.client.getSnapshot().pendingRequestId, null);
});

test("rejects malformed nested state and closes the transport without exposing it", () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(
    stateEvent({
      ...room,
      members: [{ id: "alice" } as never],
    })
  );

  assert.equal(context.client.getSnapshot().connection, "disconnected");
  assert.equal(context.client.getSnapshot().error?.code, "connection");
  assert.equal(context.client.getSnapshot().room, null);
  assert.equal(context.transport.closeCalls, 1);
});

test("reports independent cookie and history persistence failures while keeping the room live", () => {
  const context = setup();
  clients.push(context.client);
  context.credentials.throwOnSave = true;
  context.history.throwOnSave = true;
  context.transport.openSocket();
  context.transport.message(stateEvent());

  assert.equal(context.client.getSnapshot().connection, "connected");
  assert.equal(context.client.getSnapshot().phase, "active");
  assert.equal(context.client.getSnapshot().cookieSaved, false);
  assert.equal(context.client.getSnapshot().historySaved, false);
});

test("keeps an actively replaced session read-only without deleting its shared cookie", () => {
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
  assert.deepEqual(context.credentials.cleared, []);
  context.client.retry();
  assert.equal(context.transport.reconnectCalls, 0);
});

test("reconnect transitions resume and then become active only after the new snapshot", () => {
  const context = setup();
  clients.push(context.client);
  context.transport.openSocket();
  context.transport.message(stateEvent());
  context.transport.closeFromPeer();
  assert.equal(context.client.getSnapshot().connection, "disconnected");

  context.client.retry();
  assert.equal(context.client.getSnapshot().connection, "connecting");
  context.transport.openSocket();
  assert.equal(context.client.getSnapshot().phase, "resuming");
  assert.equal(context.client.getSnapshot().pendingRequestId, "1");
  context.transport.message(stateEvent(room, "1"));
  assert.equal(context.client.getSnapshot().phase, "active");
  assert.equal(context.client.getSnapshot().connection, "connected");
});

test("disposes listeners and timers so late socket events cannot revive a client", () => {
  const context = setup();
  clients.push(context.client);
  assert.equal(context.timers.timeoutCount, 1);
  context.client.dispose();
  assert.equal(context.timers.timeoutCount, 0);
  assert.equal(context.transport.disposeCalls, 1);
  context.transport.openSocket();
  assert.equal(context.client.getSnapshot().connection, "connecting");
  assert.equal(context.transport.sent.length, 0);
});

test("keeps route parsing independent from the transport", () => {
  assert.equal(parseRetroRoomCode("/retro/retro-room"), "retro-room");
  assert.equal(parseRetroRoomCode("/retro/retro-room/"), "retro-room");
  assert.equal(parseRetroRoomCode("/retro/has%2Fslash"), null);
  assert.equal(parseRetroRoomCode("/retro"), null);
});
