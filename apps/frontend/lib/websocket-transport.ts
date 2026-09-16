export const SOCKET_CONNECTING = 0;
export const SOCKET_OPEN = 1;
export const SOCKET_CLOSING = 2;
export const SOCKET_CLOSED = 3;

export type WebSocketTransportEventMap = {
  open: Event;
  message: MessageEvent;
  error: Event;
  close: CloseEvent;
};
export type WebSocketTransportEvent = keyof WebSocketTransportEventMap;
export type WebSocketTransportListener<K extends WebSocketTransportEvent> = (
  event: WebSocketTransportEventMap[K]
) => void;

/** The browser WebSocket surface needed by the shared transport. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions
  ): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface TransportTimerAdapter {
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface WebSocketHeartbeat {
  /** A protocol-specific heartbeat may be supplied without coupling protocols. */
  intervalMs: number;
  onTick: (transport: WebSocketTransport) => void;
}

export interface WebSocketTransportOptions {
  url: string;
  createSocket?: WebSocketFactory;
  queueWhileConnecting?: boolean;
  heartbeat?: WebSocketHeartbeat;
  timers?: TransportTimerAdapter;
}

const browserSocketFactory: WebSocketFactory = (url) => {
  if (typeof WebSocket === "undefined")
    throw new Error("WebSocket unavailable");
  return new WebSocket(url);
};

const browserTimers: TransportTimerAdapter = {
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (handle) => globalThis.clearInterval(handle as never),
};

type StoredListener = EventListener;
type SocketHandlers = Map<WebSocketTransportEvent, EventListener>;

/**
 * Protocol-neutral browser WebSocket lifecycle.
 *
 * The transport never parses messages or retries commands. Consumers own their
 * protocol and decide when reconnecting is safe. Queuing while CONNECTING is
 * retained for Planning Poker's existing send-before-open behavior and can be
 * disabled for protocols where replay is unsafe.
 */
export class WebSocketTransport {
  private socket: WebSocketLike | null = null;
  private socketHandlers: SocketHandlers | null = null;
  private readonly listeners = new Map<
    WebSocketTransportEvent,
    Set<StoredListener>
  >();
  private readonly queued = [] as string[];
  private heartbeatTimer: unknown;

  constructor(private readonly options: WebSocketTransportOptions) {}

  connect(): boolean {
    const current = this.socket;
    if (current) {
      if (
        current.readyState === SOCKET_OPEN ||
        current.readyState === SOCKET_CONNECTING
      )
        return true;
      this.clearHeartbeat();
      this.detachSocket(current);
      this.socket = null;
    }

    let socket: WebSocketLike;
    try {
      socket = (this.options.createSocket ?? browserSocketFactory)(
        this.options.url
      );
    } catch {
      return false;
    }

    this.socket = socket;
    this.attachSocket(socket);
    this.startHeartbeat();
    return true;
  }

  reconnect(): boolean {
    this.closeSocket();
    return this.connect();
  }

  on<K extends WebSocketTransportEvent>(
    event: K,
    listener: WebSocketTransportListener<K>
  ): () => void {
    const stored = listener as unknown as StoredListener;
    const eventListeners = this.listeners.get(event) ?? new Set();
    eventListeners.add(stored);
    this.listeners.set(event, eventListeners);
    return () => this.off(event, listener);
  }

  off<K extends WebSocketTransportEvent>(
    event: K,
    listener: WebSocketTransportListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener as unknown as StoredListener);
  }

  send(data: string, options: { queue?: boolean } = {}): boolean {
    const socket = this.socket ?? (this.connect() ? this.socket : null);
    if (!socket) return false;
    if (socket.readyState === SOCKET_OPEN) {
      try {
        socket.send(data);
        return true;
      } catch {
        return false;
      }
    }

    const queue = options.queue ?? this.options.queueWhileConnecting ?? false;
    if (socket.readyState === SOCKET_CONNECTING && queue) {
      this.queued.push(data);
      return true;
    }
    return false;
  }

  close(): void {
    this.closeSocket();
  }

  /** Stop every socket-owned listener and timer. The transport can be started again. */
  dispose(): void {
    this.closeSocket();
    this.listeners.clear();
  }

  isOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN;
  }

  getSocket(): WebSocketLike | null {
    return this.socket;
  }

  private attachSocket(socket: WebSocketLike) {
    const handlers: SocketHandlers = new Map();
    for (const event of ["open", "message", "error", "close"] as const) {
      const handler: EventListener = (value) => {
        if (this.socket !== socket) return;
        this.handleSocketEvent(socket, event, value);
      };
      handlers.set(event, handler);
      socket.addEventListener(event, handler);
    }
    this.socketHandlers = handlers;
  }

  private detachSocket(socket: WebSocketLike) {
    if (this.socketHandlers) {
      for (const [event, handler] of this.socketHandlers)
        socket.removeEventListener(event, handler);
    }
    this.socketHandlers = null;
  }

  private closeSocket() {
    this.clearHeartbeat();
    const socket = this.socket;
    if (!socket) {
      this.queued.length = 0;
      return;
    }
    this.detachSocket(socket);
    this.socket = null;
    this.queued.length = 0;
    try {
      socket.close();
    } catch {
      // Closing an already failed browser socket is best effort.
    }
  }

  private handleSocketEvent(
    socket: WebSocketLike,
    event: WebSocketTransportEvent,
    value: Event
  ) {
    if (event === "open") this.flushQueue(socket);
    if (event === "close") {
      this.clearHeartbeat();
      this.detachSocket(socket);
      this.socket = null;
      this.queued.length = 0;
    }
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) listener(value);
  }

  private flushQueue(socket: WebSocketLike) {
    if (socket.readyState !== SOCKET_OPEN || !this.queued.length) return;
    const queued = this.queued.splice(0);
    for (const data of queued) {
      try {
        socket.send(data);
      } catch {
        // A failed queued Planning Poker message must not be replayed later.
      }
    }
  }

  private startHeartbeat() {
    const heartbeat = this.options.heartbeat;
    if (!heartbeat || heartbeat.intervalMs <= 0 || this.heartbeatTimer) return;
    const timers = this.options.timers ?? browserTimers;
    this.heartbeatTimer = timers.setInterval(() => {
      if (this.isOpen()) heartbeat.onTick(this);
    }, heartbeat.intervalMs);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer === undefined) return;
    (this.options.timers ?? browserTimers).clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
}
