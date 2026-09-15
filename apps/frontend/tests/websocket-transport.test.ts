import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOCKET_CLOSED,
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  WebSocketTransport,
  type WebSocketLike,
  type TransportTimerAdapter,
} from "../lib/websocket-transport";

type Listener = (event: Event) => void;

class FakeSocket implements WebSocketLike {
  readyState = SOCKET_CONNECTING;
  readonly sent: string[] = [];
  closeCalls = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  send(data: string) {
    if (this.readyState !== SOCKET_OPEN) throw new Error("not open");
    this.sent.push(data);
  }

  close() {
    this.closeCalls++;
    this.readyState = SOCKET_CLOSED;
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as Listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  emit(type: string, event = {} as Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.readyState = SOCKET_OPEN;
    this.emit("open");
  }

  peerClose() {
    this.readyState = SOCKET_CLOSED;
    this.emit("close", { code: 1000 } as CloseEvent);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeIntervals implements TransportTimerAdapter {
  readonly callbacks = new Map<number, () => void>();
  private nextId = 0;

  setInterval(callback: () => void) {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  }

  clearInterval(handle: unknown) {
    this.callbacks.delete(handle as number);
  }

  tick() {
    for (const callback of this.callbacks.values()) callback();
  }
}

test("owns listeners and queues Planning Poker sends until open", () => {
  const sockets: FakeSocket[] = [];
  const transport = new WebSocketTransport({
    url: "ws://example.test/socket",
    queueWhileConnecting: true,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const opens: Event[] = [];
  const unsubscribe = transport.on("open", (event) => opens.push(event));

  assert.equal(transport.connect(), true);
  assert.equal(transport.send("queued"), true);
  assert.equal(sockets[0].sent.length, 0);
  sockets[0].open();
  assert.deepEqual(sockets[0].sent, ["queued"]);
  assert.equal(opens.length, 1);
  assert.equal(transport.isOpen(), true);

  unsubscribe();
  transport.dispose();
  assert.equal(sockets[0].listenerCount("open"), 0);
  assert.equal(sockets[0].closeCalls, 1);
});

test("reconnects through a fresh socket and never delivers stale socket events", () => {
  const sockets: FakeSocket[] = [];
  const transport = new WebSocketTransport({
    url: "ws://example.test/socket",
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  let closes = 0;
  transport.on("close", () => closes++);
  transport.connect();
  sockets[0].open();
  assert.equal(transport.reconnect(), true);
  assert.equal(sockets[0].closeCalls, 1);
  assert.equal(sockets[0].listenerCount("close"), 0);
  sockets[0].peerClose();
  assert.equal(closes, 0);
  sockets[1].open();
  sockets[1].peerClose();
  assert.equal(closes, 1);
  assert.equal(transport.isOpen(), false);
  transport.dispose();
});

test("heartbeat callbacks and their interval are stopped by close and dispose", () => {
  const intervals = new FakeIntervals();
  const socket = new FakeSocket();
  let heartbeats = 0;
  const transport = new WebSocketTransport({
    url: "ws://example.test/socket",
    createSocket: () => socket,
    heartbeat: {
      intervalMs: 1000,
      onTick: () => heartbeats++,
    },
    timers: intervals,
  });
  transport.connect();
  socket.open();
  assert.equal(intervals.callbacks.size, 1);
  intervals.tick();
  assert.equal(heartbeats, 1);
  transport.close();
  assert.equal(intervals.callbacks.size, 0);
  intervals.tick();
  assert.equal(heartbeats, 1);
  transport.dispose();
});
