import { z } from "zod";
import type {
  RetroActionOwner,
  RetroCommand,
  RetroRoom,
} from "shared/retrospective";
import {
  initialRetroSessionState,
  retroSessionReducer,
  type RetroFailure,
  type RetroSessionState,
} from "./retro-session-state";
import type {
  WebSocketTransportEventMap,
  WebSocketTransportEvent,
} from "./websocket-transport";

export interface RetroCredentialStorage {
  read(code: string): string | null;
  save(code: string, token: string, expiresAt: number): boolean;
  clear(code: string): void;
}

export interface RetroHistoryStorage {
  save(room: RetroRoom, viewerId: string): boolean;
}

export interface RetroClock {
  now(): number;
}

export interface RetroTimerStorage {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The client supplies route formatting; the protocol client never reads history globals. */
export interface RetroNavigationAdapter {
  replaceRoom(code: string): void;
}

export interface RetroTransport {
  connect(): boolean;
  reconnect(): boolean;
  send(data: string, options?: { queue?: boolean }): boolean;
  close(): void;
  dispose(): void;
  isOpen(): boolean;
  on<K extends WebSocketTransportEvent>(
    event: K,
    listener: (value: WebSocketTransportEventMap[K]) => void
  ): () => void;
}

export interface RetroSessionClientOptions {
  transport: RetroTransport;
  initialCode?: string | null;
  credentials: RetroCredentialStorage;
  history: RetroHistoryStorage;
  clock: RetroClock;
  timers: RetroTimerStorage;
  navigation: RetroNavigationAdapter;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const id = z.string().min(1).max(64);
const roomCode = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const participantName = z.string().min(3).max(30);
const text = z.string().min(1).max(1000);
const memberSchema = z.object({
  id,
  name: participantName,
  moderator: z.boolean(),
  connected: z.boolean(),
  ready: z.boolean(),
});
const noteSchema = z.object({
  id,
  authorId: id,
  authorName: participantName,
  column: z.enum(["went-well", "improve", "ideas"]),
  text,
  groupId: id.nullable(),
  voteCount: z.number().int().min(0).max(30).nullable(),
  votedBySelf: z.boolean(),
});
const groupSchema = z.object({
  id,
  title: z.string().min(1).max(100),
  voteCount: z.number().int().min(0).max(30).nullable(),
  votedBySelf: z.boolean(),
});
const actionOwnerSchema: z.ZodType<RetroActionOwner> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("unassigned") }),
    z.object({
      kind: z.literal("participant"),
      participantId: id,
      name: participantName,
    }),
    z.object({
      kind: z.literal("external"),
      name: z.string().min(1).max(60),
    }),
  ]
);
const actionSchema = z.object({
  id,
  text,
  owner: actionOwnerSchema,
  done: z.boolean(),
});
const roomSchema: z.ZodType<RetroRoom> = z.object({
  code: roomCode,
  title: z.string().min(1).max(100),
  phase: z.enum(["write", "group", "vote", "discuss", "closed"]),
  expiresAt: z.number().int().nonnegative().max(8.64e15),
  closedAt: z.number().int().nonnegative().max(8.64e15).nullable(),
  members: memberSchema.array().max(30),
  notes: noteSchema.array().max(300),
  groups: groupSchema.array().max(300),
  actions: actionSchema.array().max(100),
});
const retroServerEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("retro-state"),
    data: z.object({
      room: roomSchema,
      self: z.object({ id, token: id }),
      requestId: z.string().max(64).optional(),
    }),
  }),
  z.object({
    event: z.literal("retro-error"),
    data: z.object({
      code: z.string().min(1).max(100),
      message: z.string().min(1).max(1000),
      requestId: z.string().max(64).optional(),
    }),
  }),
]);
type RetroServerEvent = z.infer<typeof retroServerEventSchema>;

type PendingRequest = {
  id: string;
  kind: "resume" | "mutation";
  timer: unknown;
  resolve: (success: boolean) => void;
};

const CONNECTION_FAILURE: RetroFailure = {
  code: "connection",
  message:
    "Unable to reach the retrospective server. Retry when your connection is available.",
};
const REQUEST_FAILURE: RetroFailure = {
  code: "connection",
  message:
    "Connection lost before confirmation. Retry, then check the room before repeating your change.",
};
const CONFIGURATION_FAILURE: RetroFailure = {
  code: "configuration",
  message: "Could not connect. Check the NEXT_PUBLIC_WS_URL configuration.",
};
const CONNECTION_TIMEOUT_FAILURE: RetroFailure = {
  code: "connection",
  message: "Connection timed out. Retry to resume this session.",
};
const REQUEST_TIMEOUT_FAILURE: RetroFailure = {
  code: "timeout",
  message:
    "No confirmation received. Retry to refresh the room before repeating your change.",
};
const INVALID_RESPONSE_FAILURE: RetroFailure = {
  code: "connection",
  message: "Received an invalid response. Retry to get a fresh room snapshot.",
};
const TERMINAL_CODES = new Set(["room-expired", "invalid-session", "removed"]);

/**
 * Retrospective protocol/session client. It owns request correlation and
 * explicitly refuses to replay a mutation after a disconnected request.
 * Browser capabilities are all passed as adapters so this class is testable
 * without a DOM, WebSocket, clock, or storage implementation.
 */
export class RetroSessionClient {
  private state = initialRetroSessionState;
  private readonly listeners = new Set<() => void>();
  private readonly connectionTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private started = false;
  private connectionTimer: unknown;
  private credentialsValue: { code: string; token: string } | null = null;
  private pendingRequest: PendingRequest | null = null;
  private nextRequestId = 0;
  private notificationGeneration = 0;
  private scheduledNotificationGeneration: number | undefined;
  private transportSubscriptions: (() => void)[] = [];

  constructor(private readonly options: RetroSessionClientOptions) {
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RetroSessionState => this.state;

  start = (): void => {
    if (this.started || this.state.phase === "terminal") return;
    this.started = true;
    this.loadInitialCredentials();
    const resuming = !!this.credentialsValue;
    this.transition({ type: "start", resuming });
    this.transportSubscriptions = [
      this.options.transport.on("open", this.handleOpen),
      this.options.transport.on("message", this.handleMessage),
      this.options.transport.on("error", this.handleSocketError),
      this.options.transport.on("close", this.handleClose),
    ];
    this.armConnectionTimer();
    if (!this.options.transport.connect())
      this.failConnection(CONFIGURATION_FAILURE);
  };

  dispose = (): void => {
    this.started = false;
    this.notificationGeneration++;
    this.scheduledNotificationGeneration = undefined;
    this.clearConnectionTimer();
    this.finishPending(false);
    for (const unsubscribe of this.transportSubscriptions) unsubscribe();
    this.transportSubscriptions = [];
    this.options.transport.dispose();
  };

  retry = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.clearConnectionTimer();
    this.finishPending(false);
    const resuming = !!this.credentialsValue;
    this.transition({ type: "retry", resuming });
    this.armConnectionTimer();
    if (!this.options.transport.reconnect())
      this.failConnection(CONFIGURATION_FAILURE);
  };

  send = (command: RetroCommand): Promise<boolean> => {
    const current = this.state;
    if (
      !this.started ||
      current.connection !== "connected" ||
      current.phase === "terminal" ||
      current.phase === "resuming" ||
      this.pendingRequest
    )
      return Promise.resolve(false);
    if (
      current.room &&
      (current.room.phase === "closed" ||
        current.room.expiresAt <= this.options.clock.now())
    )
      return Promise.resolve(false);

    let outgoing = command;
    let kind: PendingRequest["kind"] = "mutation";
    if (command.type === "join") {
      const token = this.readCredential(command.code);
      if (token) {
        this.credentialsValue = { code: command.code, token };
        outgoing = { type: "resume", code: command.code, token };
        kind = "resume";
      }
    } else if (command.type === "resume") {
      this.credentialsValue = { code: command.code, token: command.token };
      kind = "resume";
    }
    return this.issue(outgoing, kind);
  };

  private handleOpen = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.clearConnectionTimer();
    const resuming = !!this.credentialsValue;
    this.transition({ type: "open", resuming });
    if (this.credentialsValue) {
      this.issue({ type: "resume", ...this.credentialsValue }, "resume");
    }
  };

  private handleMessage = (
    event: WebSocketTransportEventMap["message"]
  ): void => {
    if (!this.started || !this.options.transport.isOpen()) return;
    const parsed = this.parseMessage(event.data);
    if (!parsed) {
      this.failConnection(INVALID_RESPONSE_FAILURE);
      return;
    }
    if (parsed.event === "retro-state") this.handleState(parsed);
    else this.handleError(parsed);
  };

  private handleSocketError = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.failConnection(CONNECTION_FAILURE);
  };

  private handleClose = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.clearConnectionTimer();
    const hadPending = !!this.pendingRequest;
    this.finishPending(false);
    this.transition({
      type: "connection-failed",
      error: hadPending
        ? REQUEST_FAILURE
        : (this.state.error ?? CONNECTION_FAILURE),
    });
  };

  private handleState(
    event: Extract<RetroServerEvent, { event: "retro-state" }>
  ) {
    const pending = this.pendingRequest;
    const acknowledged =
      !pending ||
      event.data.requestId === pending.id ||
      (pending.kind === "resume" && event.data.requestId === undefined);
    const { room, self } = event.data;
    this.credentialsValue = { code: room.code, token: self.token };
    this.saveCredentials(room.code, self.token, room.expiresAt);
    this.saveHistory(room, self.id);
    this.navigate(room.code);
    this.transition(
      {
        type: "snapshot",
        room,
        selfId: self.id,
        acknowledged,
      },
      false
    );
    if (acknowledged && pending) this.finishPending(true, false);
    // Resolve the command before publishing the room update. React editors can
    // clear their local draft in the promise continuation, preventing an
    // intermediate render that shows both the committed note and old draft.
    this.notifySoon();
  }

  private handleError(
    event: Extract<RetroServerEvent, { event: "retro-error" }>
  ) {
    this.clearConnectionTimer();
    const pending = this.pendingRequest;
    const acknowledged =
      !pending ||
      event.data.requestId === pending.id ||
      (pending.kind === "resume" && event.data.requestId === undefined);
    // Connection-level rejection must still win over a pending mutation. The
    // replacement close has no request id and must never be mistaken for an
    // ordinary mutation response.
    if (!TERMINAL_CODES.has(event.data.code) && !acknowledged) return;

    if (TERMINAL_CODES.has(event.data.code)) {
      this.handleTerminalError(event.data);
      return;
    }
    if (pending && acknowledged) this.finishPending(false);
    const failure = { code: event.data.code, message: event.data.message };
    this.transition({ type: "server-error", error: failure });
    if (this.state.phase === "resuming") {
      // A failed resume must not leave a stale snapshot editable. Keep the
      // server's useful error while making the socket/session unavailable.
      this.transition({ type: "connection-failed", error: failure });
      this.options.transport.close();
    }
  }

  private handleTerminalError(error: RetroFailure) {
    const preserveCredential =
      error.code === "invalid-session" &&
      this.state.phase === "active" &&
      this.state.room !== null;
    if (this.credentialsValue && !preserveCredential)
      this.clearCredential(this.credentialsValue.code);
    this.credentialsValue = null;
    this.finishPending(false);
    this.clearConnectionTimer();
    this.transition({
      type: "connection-failed",
      error,
      terminal: true,
      clearSelf: true,
    });
    this.options.transport.close();
  }

  private issue(
    command: RetroCommand,
    kind: PendingRequest["kind"]
  ): Promise<boolean> {
    const requestId = String(++this.nextRequestId);
    const promise = new Promise<boolean>((resolve) => {
      const timer = this.options.timers.setTimeout(
        () => this.handleRequestTimeout(requestId),
        this.requestTimeoutMs
      );
      this.pendingRequest = { id: requestId, kind, timer, resolve };
      this.transition({
        type: "request-started",
        requestId,
        resuming: kind === "resume",
      });
      const sent = this.options.transport.send(
        JSON.stringify({
          event: "retro-command",
          data: { ...command, requestId },
        }),
        { queue: false }
      );
      if (!sent) {
        this.finishPending(false);
        this.failConnection(CONNECTION_FAILURE);
      }
    });
    return promise;
  }

  private handleRequestTimeout(requestId: string) {
    if (!this.pendingRequest || this.pendingRequest.id !== requestId) return;
    this.finishPending(false);
    this.clearConnectionTimer();
    this.transition({
      type: "connection-failed",
      error: REQUEST_TIMEOUT_FAILURE,
    });
    this.options.transport.close();
  }

  private finishPending(success: boolean, notify = true) {
    const pending = this.pendingRequest;
    if (!pending) return;
    this.options.timers.clearTimeout(pending.timer);
    this.pendingRequest = null;
    this.transition(
      {
        type: "request-settled",
        requestId: pending.id,
        success,
      },
      notify
    );
    pending.resolve(success);
  }

  private loadInitialCredentials() {
    if (this.credentialsValue || !this.options.initialCode) return;
    const token = this.readCredential(this.options.initialCode);
    if (token)
      this.credentialsValue = { code: this.options.initialCode, token };
  }

  private readCredential(code: string): string | null {
    try {
      return this.options.credentials.read(code);
    } catch {
      return null;
    }
  }

  private saveCredentials(code: string, token: string, expiresAt: number) {
    try {
      this.state = {
        ...this.state,
        cookieSaved: this.options.credentials.save(code, token, expiresAt),
      };
    } catch {
      this.state = { ...this.state, cookieSaved: false };
    }
  }

  private clearCredential(code: string) {
    try {
      this.options.credentials.clear(code);
    } catch {
      // A blocked cookie store must not prevent the terminal transition.
    }
  }

  private saveHistory(room: RetroRoom, viewerId: string) {
    try {
      this.state = {
        ...this.state,
        historySaved: this.options.history.save(room, viewerId),
      };
    } catch {
      this.state = { ...this.state, historySaved: false };
    }
  }

  private navigate(code: string) {
    try {
      this.options.navigation.replaceRoom(code);
    } catch {
      // A history adapter failure should not turn a valid live snapshot into a
      // protocol failure. The room remains usable at its current URL.
    }
  }

  private parseMessage(data: unknown): RetroServerEvent | null {
    try {
      const raw = typeof data === "string" ? JSON.parse(data) : data;
      const parsed = retroServerEventSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private armConnectionTimer() {
    this.clearConnectionTimer();
    this.connectionTimer = this.options.timers.setTimeout(
      () => this.failConnection(CONNECTION_TIMEOUT_FAILURE),
      this.connectionTimeoutMs
    );
  }

  private clearConnectionTimer() {
    if (this.connectionTimer === undefined) return;
    this.options.timers.clearTimeout(this.connectionTimer);
    this.connectionTimer = undefined;
  }

  private failConnection(error: RetroFailure) {
    if (!this.started || this.state.phase === "terminal") return;
    this.clearConnectionTimer();
    this.finishPending(false);
    this.transition({ type: "connection-failed", error });
    this.options.transport.close();
  }

  private transition(
    action: Parameters<typeof retroSessionReducer>[1],
    notify = true
  ) {
    const next = retroSessionReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    if (notify) this.notify();
  }

  private notifySoon() {
    if (this.scheduledNotificationGeneration !== undefined) return;
    const generation = this.notificationGeneration;
    this.scheduledNotificationGeneration = generation;
    globalThis.queueMicrotask(() => {
      if (this.scheduledNotificationGeneration !== generation) return;
      this.scheduledNotificationGeneration = undefined;
      this.notify();
    });
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export function createRetroSessionClient(
  options: RetroSessionClientOptions
): RetroSessionClient {
  return new RetroSessionClient(options);
}
