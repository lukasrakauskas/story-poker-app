import {
  materializeRetroState,
  retroVersionStatus,
} from "shared/retrospective";
import type {
  RetroCommand,
  RetroRememberedIdentity,
  RetroRoom,
  RetroServerEvent,
  RetroSessionView,
} from "shared/retrospective";
import {
  createRetroReconnectPolicy,
  type RetroReconnectPolicy,
} from "./retro-reconnect-policy";
import type { RetroRecovery } from "./retro-session-state";
import { parseRetroServerEvent } from "./retro-protocol";
import {
  initialRetroSessionState,
  retroSessionReducer,
  type RememberedIdentityStatus,
  type RetroFailure,
  type RetroSessionState,
} from "./retro-session-state";
import type {
  WebSocketTransportEvent,
  WebSocketTransportEventMap,
} from "./websocket-transport";

/**
 * Browser session boundary. Implementations use credentialed HTTP requests;
 * the credential is intentionally not represented in this interface or in
 * the client state, because the backend owns it in an HttpOnly cookie.
 */
export interface RetroSessionApi {
  establish(
    command: Extract<RetroCommand, { type: "create" | "join" }>
  ): Promise<RetroSessionView>;
  inspect(code: string): Promise<RetroRememberedIdentity>;
  resume(code: string): Promise<RetroSessionView>;
  forget(code: string): Promise<boolean>;
}

export interface RetroHistoryStorage {
  save(room: RetroRoom, viewerId: string): boolean | null;
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
  sessions: RetroSessionApi;
  history: RetroHistoryStorage;
  clock: RetroClock;
  timers: RetroTimerStorage;
  navigation: RetroNavigationAdapter;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  reconnectPolicy?: RetroReconnectPolicy;
  maxReconnectAttempts?: number;
}

type PendingKind = "resume" | "mutation" | "inspect" | "refresh";
type PendingRequest = {
  id: string;
  kind: PendingKind;
  code?: string;
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
const INVALID_ROOM_CODE_FAILURE: RetroFailure = {
  code: "invalid-room-code",
  message:
    "That room link is invalid. Room codes use 1–64 letters, numbers, hyphens, or underscores.",
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
const TERMINAL_CODES = new Set([
  "room-expired",
  "invalid-session",
  "session-required",
  "session-replaced",
  "removed",
]);

function isEntryCommand(
  command: RetroCommand
): command is Extract<RetroCommand, { type: "create" | "join" }> {
  return command.type === "create" || command.type === "join";
}

function failureFrom(cause: unknown, fallback: RetroFailure): RetroFailure {
  if (typeof cause === "object" && cause !== null) {
    const value = cause as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string")
      return { code: value.code, message: value.message };
  }
  return fallback;
}

function isValidCode(code: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(code);
}

/**
 * Protocol/session client. It owns request correlation and refuses to replay a
 * mutation after a disconnect. HTTP rotates the HttpOnly cookie before every
 * reconnect; WebSocket only receives a room code and never a bearer token.
 */
export class RetroSessionClient {
  private state = initialRetroSessionState;
  private readonly listeners = new Set<() => void>();
  private readonly connectionTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private started = false;
  private connectionTimer: unknown;
  private pendingRequest: PendingRequest | null = null;
  private nextRequestId = 0;
  private notificationGeneration = 0;
  private scheduledNotificationGeneration: number | undefined;
  private transportSubscriptions: (() => void)[] = [];
  private activeCode: string | null = null;
  private resumeRequired = false;
  private resumePrepared = false;
  private identityInspection = 0;
  private reconnectTimer: unknown;
  private stableTimer: unknown;
  private online = true;
  private visible = true;
  private uncertainty: RetroFailure | null = null;
  private latestVersion: number | null = null;
  private readonly reconnectPolicy: RetroReconnectPolicy;

  constructor(private readonly options: RetroSessionClientOptions) {
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.activeCode = options.initialCode ?? null;
    this.reconnectPolicy =
      options.reconnectPolicy ?? createRetroReconnectPolicy();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RetroSessionState => this.state;

  start = (): void => {
    if (this.started || this.state.phase === "terminal") return;
    this.started = true;
    if (this.activeCode && !isValidCode(this.activeCode)) {
      this.transition({
        type: "connection-failed",
        error: INVALID_ROOM_CODE_FAILURE,
        terminal: true,
      });
      return;
    }
    this.transition({ type: "start", resuming: false });
    this.transportSubscriptions = [
      this.options.transport.on("open", this.handleOpen),
      this.options.transport.on("message", this.handleMessage),
      this.options.transport.on("error", this.handleSocketError),
      this.options.transport.on("close", this.handleClose),
    ];
    this.armConnectionTimer();
    if (this.activeCode) void this.inspectRemembered(this.activeCode);
    if (!this.options.transport.connect())
      this.failConnection(CONFIGURATION_FAILURE);
  };

  dispose = (): void => {
    this.started = false;
    this.notificationGeneration++;
    this.identityInspection++;
    this.clearRecoveryTimers();
    this.scheduledNotificationGeneration = undefined;
    this.clearConnectionTimer();
    this.finishPending(false);
    for (const unsubscribe of this.transportSubscriptions) unsubscribe();
    this.transportSubscriptions = [];
    this.options.transport.dispose();
  };

  retry = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.clearRecoveryTimers();
    if (this.state.recovery === "exhausted") this.reconnectPolicy.reset();
    if (!this.online || !this.visible) {
      this.scheduleRecovery();
      return;
    }
    this.setRecovery("connecting");
    this.clearConnectionTimer();
    // A mutation that was not acknowledged is never replayed. An established
    // room is resumed through a fresh HTTP rotation after the socket opens.
    this.finishPending(false);
    this.resumePrepared = false;
    const resuming = !!this.activeCode && this.resumeRequired;
    this.transition({ type: "retry", resuming });
    if (resuming) {
      // Rotate before the new handshake; opening with the stale cookie first
      // would waste a connection and race its replacement.
      void this.beginResume(this.activeCode!);
      return;
    }
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

    if (command.type !== "inspect" && command.type !== "resume")
      this.uncertainty = null;
    if (isEntryCommand(command)) return this.beginEstablish(command);
    if (command.type === "resume") return this.beginResume(command.code);
    return this.issue(
      command,
      command.type === "inspect" ? "inspect" : "mutation"
    );
  };

  inspectRemembered = async (
    code: string
  ): Promise<"valid" | "invalid" | "none"> => {
    if (!isValidCode(code)) {
      this.setRememberedStatus("invalid");
      return "invalid";
    }
    const inspection = ++this.identityInspection;
    this.transition({ type: "remembered-status", status: "checking" });
    try {
      const identity = await this.options.sessions.inspect(code);
      if (
        !this.started ||
        inspection !== this.identityInspection ||
        identity.code !== code
      )
        return "invalid";
      this.transition({ type: "remembered-identity", identity });
      return "valid";
    } catch (cause) {
      if (!this.started || inspection !== this.identityInspection)
        return "invalid";
      const failure = failureFrom(cause, CONNECTION_FAILURE);
      if (failure.code === "session-required") {
        this.transition({ type: "remembered-cleared", status: "idle" });
        return "none";
      }
      if (failure.code === "invalid-session") {
        // A rejected remembered cookie is not a transport failure. Keep the
        // anonymous entry form usable; the explicit status tells the user to
        // choose a new identity and a later HTTP join replaces this cookie.
        this.transition({ type: "remembered-cleared", status: "invalid" });
        return "invalid";
      }
      this.transition({ type: "remembered-cleared", status: "idle" });
      this.transition({ type: "server-error", error: failure });
      return "invalid";
    }
  };

  continueRememberedSession = (code?: string): Promise<boolean> => {
    const target =
      code ?? this.state.rememberedIdentity?.code ?? this.activeCode;
    if (!target || !this.state.rememberedIdentity)
      return Promise.resolve(false);
    return this.beginResume(target);
  };

  forgetRememberedSession = async (code?: string): Promise<boolean> => {
    const target =
      code ?? this.state.rememberedIdentity?.code ?? this.activeCode;
    if (!target || this.state.phase === "terminal") return false;
    try {
      const forgotten = await this.options.sessions.forget(target);
      if (!forgotten || !this.started) return false;
      if (this.activeCode === target) {
        this.resumeRequired = false;
        this.resumePrepared = false;
      }
      this.transition({ type: "remembered-cleared", status: "forgotten" });
      return true;
    } catch (cause) {
      this.transition({
        type: "server-error",
        error: failureFrom(cause, CONNECTION_FAILURE),
      });
      return false;
    }
  };

  private handleOpen = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.clearConnectionTimer();
    const resuming = !!this.activeCode && this.resumeRequired;
    this.transition({ type: "open", resuming });
    if (!resuming) return;
    if (this.resumePrepared && this.pendingRequest) {
      this.sendPreparedResume();
      return;
    }
    if (!this.pendingRequest) void this.beginResume(this.activeCode!);
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
    else if (parsed.event === "retro-room-info") this.handleRoomInfo(parsed);
    else this.handleError(parsed);
  };

  private handleSocketError = (): void => {
    if (!this.started || this.state.phase === "terminal") return;
    this.failConnection(CONNECTION_FAILURE);
  };

  private handleClose = (event: WebSocketTransportEventMap["close"]): void => {
    if (!this.started || this.state.phase === "terminal") return;
    if (event.code === 4001 || event.code === 4003 || event.code === 4004) {
      this.handleTerminalError({
        code: event.code === 4003 ? "removed" : "invalid-session",
        message:
          event.code === 4001
            ? "Your session was resumed in another connection."
            : "This session was removed or forgotten. Join as someone else.",
      });
      return;
    }
    this.clearConnectionTimer();
    const hadPending = this.pendingRequest?.kind === "mutation";
    if (hadPending) this.uncertainty = REQUEST_FAILURE;
    this.finishPending(false);
    if (this.activeCode && this.state.phase === "active")
      this.resumeRequired = true;
    this.transition({
      type: "connection-failed",
      error: hadPending
        ? REQUEST_FAILURE
        : (this.uncertainty ?? this.state.error ?? CONNECTION_FAILURE),
    });
    this.scheduleRecovery();
  };

  private handleState(
    event: Extract<RetroServerEvent, { event: "retro-state" }>
  ) {
    const pending = this.pendingRequest;
    const acknowledged =
      !pending ||
      event.data.requestId === pending.id ||
      (pending.kind === "resume" && event.data.requestId === undefined);
    const { self } = event.data;
    if (this.activeCode && event.data.room.code !== this.activeCode) {
      this.failConnection(INVALID_RESPONSE_FAILURE);
      return;
    }
    const versionStatus = retroVersionStatus(
      this.latestVersion,
      event.data.version,
      !!pending && acknowledged
    );
    if (versionStatus === "stale") {
      // A late request-specific ACK still settles its mutation, but must never
      // roll the displayed board back to an older committed version.
      if (pending && acknowledged) this.finishPending(true);
      return;
    }
    if (versionStatus === "gap") {
      if (pending?.kind === "refresh") return;
      if (pending?.kind === "mutation")
        this.uncertainty = {
          code: "connection",
          message:
            "A room update was missed. Your last change is unconfirmed; verify the refreshed room before trying it again.",
        };
      this.finishPending(false);
      void this.issue({ type: "refresh" }, "refresh");
      return;
    }
    const room = materializeRetroState(event.data);
    this.latestVersion = event.data.version;
    this.activeCode = room.code;
    this.resumeRequired = true;
    this.resumePrepared = true;
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
    if (this.uncertainty)
      this.state = { ...this.state, error: this.uncertainty };
    this.setRecovery("idle");
    if (this.stableTimer === undefined)
      this.stableTimer = this.options.timers.setTimeout(() => {
        this.stableTimer = undefined;
        this.reconnectPolicy.reset();
        this.setRecovery("idle");
      }, 30_000);
    this.notifySoon();
  }

  private handleRoomInfo(
    event: Extract<RetroServerEvent, { event: "retro-room-info" }>
  ) {
    const pending = this.pendingRequest;
    if (pending?.kind === "inspect" && pending.code !== event.data.code) return;
    const acknowledged = !pending || event.data.requestId === pending.id;
    if (!acknowledged) return;
    const { requestId: _requestId, ...info } = event.data;
    this.transition({ type: "room-info", info }, false);
    if (pending) this.finishPending(true, false);
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
    if (!TERMINAL_CODES.has(event.data.code) && !acknowledged) return;

    if (TERMINAL_CODES.has(event.data.code)) {
      this.handleTerminalError(event.data);
      return;
    }
    if (pending && acknowledged) this.finishPending(false);
    const failure = { code: event.data.code, message: event.data.message };
    this.transition({ type: "server-error", error: failure });
    if (this.state.phase === "resuming") {
      this.transition({ type: "connection-failed", error: failure });
      this.options.transport.close();
    }
  }

  private handleTerminalError(error: RetroFailure) {
    // An active socket displaced by another tab must retain the cookie owned by
    // that tab. HTTP rotation/forget has already made the old value unusable.
    this.finishPending(false);
    this.clearConnectionTimer();
    this.clearRecoveryTimers();
    this.setRecovery("idle");
    this.transition({
      type: "connection-failed",
      error,
      terminal: true,
      clearSelf: true,
    });
    this.options.transport.close();
  }

  private beginEstablish(
    command: Extract<RetroCommand, { type: "create" | "join" }>
  ): Promise<boolean> {
    const pending = this.createPending("resume", true);
    void this.options.sessions
      .establish(command)
      .then((view) => {
        if (!this.started || this.pendingRequest?.id !== pending.id) return;
        this.activeCode = view.room.code;
        this.resumeRequired = true;
        // The cookie was freshly installed by HTTP. It can be attached to the
        // socket without another rotation; all subsequent reconnects rotate.
        this.resumePrepared = true;
        // The browser cannot change Cookie headers on an already-open
        // WebSocket. Reopen after HTTP has installed the fresh HttpOnly
        // cookie, then send the room-code-only resume on the new handshake.
        const connected = this.options.transport.isOpen()
          ? this.options.transport.reconnect()
          : this.options.transport.connect();
        if (!connected) this.failPending(CONNECTION_FAILURE);
      })
      .catch((cause) => {
        if (this.started && this.pendingRequest?.id === pending.id)
          this.failEstablishment(failureFrom(cause, CONNECTION_FAILURE));
      });
    return pending.promise;
  }

  private beginResume(code: string): Promise<boolean> {
    if (!isValidCode(code) || !this.started || this.pendingRequest)
      return Promise.resolve(false);
    this.activeCode = code;
    this.resumeRequired = true;
    const pending = this.createPending("resume", true);
    this.transition({ type: "remembered-status", status: "resuming" });
    void this.options.sessions
      .resume(code)
      .then((view) => {
        if (
          !this.started ||
          this.pendingRequest?.id !== pending.id ||
          view.room.code !== code
        )
          return;
        this.resumePrepared = true;
        // Rotation changes the HttpOnly cookie, so an existing WebSocket must
        // be replaced before the resume command can be authenticated.
        const connected = this.options.transport.isOpen()
          ? this.options.transport.reconnect()
          : this.options.transport.connect();
        if (!connected) this.failPending(CONNECTION_FAILURE);
      })
      .catch((cause) => {
        if (!this.started || this.pendingRequest?.id !== pending.id) return;
        const failure = failureFrom(cause, CONNECTION_FAILURE);
        if (failure.code === "invalid-session")
          this.transition({ type: "remembered-cleared", status: "invalid" });
        if (!this.state.room) {
          this.resumeRequired = false;
          this.resumePrepared = false;
          this.finishPending(false);
          this.transition({ type: "entry-failed", error: failure });
        } else {
          this.failPending(failure);
        }
      });
    return pending.promise;
  }

  private sendPreparedResume() {
    const pending = this.pendingRequest;
    if (!pending || pending.kind !== "resume" || !this.activeCode) return;
    const sent = this.options.transport.send(
      JSON.stringify({
        event: "retro-command",
        data: {
          type: "resume",
          code: this.activeCode,
          requestId: pending.id,
        },
      }),
      { queue: false }
    );
    if (!sent) this.failPending(CONNECTION_FAILURE);
  }

  private issue(command: RetroCommand, kind: PendingKind): Promise<boolean> {
    const pending = this.createPending(
      kind,
      false,
      command.type === "inspect" ? command.code : undefined
    );
    const sent = this.options.transport.send(
      JSON.stringify({
        event: "retro-command",
        data: { ...command, requestId: pending.id },
      }),
      { queue: false }
    );
    if (!sent) this.failPending(CONNECTION_FAILURE);
    return pending.promise;
  }

  private createPending(kind: PendingKind, resuming: boolean, code?: string) {
    const id = String(++this.nextRequestId);
    let resolvePromise!: (success: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    const timer = this.options.timers.setTimeout(
      () => this.handleRequestTimeout(id),
      this.requestTimeoutMs
    );
    this.pendingRequest = {
      id,
      kind,
      code,
      timer,
      resolve: resolvePromise,
    };
    this.transition({ type: "request-started", requestId: id, resuming });
    return { id, promise };
  }

  private handleRequestTimeout(requestId: string) {
    if (!this.pendingRequest || this.pendingRequest.id !== requestId) return;
    this.failPending(REQUEST_TIMEOUT_FAILURE);
    this.options.transport.close();
  }

  private failEstablishment(error: RetroFailure) {
    // HTTP entry failures (especially a wrong room password) must leave the
    // anonymous lobby connected so the user can correct the form without a
    // needless reconnect. No cookie has been issued on this path.
    this.finishPending(false);
    this.transition({ type: "entry-failed", error });
  }

  private failPending(error: RetroFailure) {
    if (TERMINAL_CODES.has(error.code)) {
      this.handleTerminalError(error);
      return;
    }
    if (this.pendingRequest?.kind === "mutation") this.uncertainty = error;
    this.finishPending(false);
    this.transition({ type: "server-error", error });
    this.transition({ type: "connection-failed", error });
    this.options.transport.close();
    this.scheduleRecovery();
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
      // A history adapter failure must not turn a valid live snapshot into a
      // protocol failure.
    }
  }

  private parseMessage(data: unknown): RetroServerEvent | null {
    try {
      const raw = typeof data === "string" ? JSON.parse(data) : data;
      return parseRetroServerEvent(raw);
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
    if (this.pendingRequest?.kind === "mutation")
      this.uncertainty = REQUEST_FAILURE;
    this.finishPending(false);
    this.transition({
      type: "connection-failed",
      error: this.uncertainty ?? error,
    });
    this.options.transport.close();
    if (error.code !== "configuration") this.scheduleRecovery();
  }

  setEnvironment = (online: boolean, visible: boolean): void => {
    this.online = online;
    this.visible = visible;
    if (!this.started || this.state.phase === "terminal") return;
    if (!online && this.state.room) this.failConnection(CONNECTION_FAILURE);
    else if (this.state.connection === "disconnected") {
      if (online && visible) this.retry();
      else {
        this.clearRecoveryTimers();
        this.scheduleRecovery();
      }
    }
  };

  private setRecovery(recovery: RetroRecovery) {
    this.state = {
      ...this.state,
      recovery,
      reconnectAttempt: this.reconnectPolicy.attempt,
    };
    this.notify();
  }

  private clearRecoveryTimers() {
    if (this.reconnectTimer !== undefined)
      this.options.timers.clearTimeout(this.reconnectTimer);
    if (this.stableTimer !== undefined)
      this.options.timers.clearTimeout(this.stableTimer);
    this.reconnectTimer = undefined;
    this.stableTimer = undefined;
  }

  private scheduleRecovery() {
    if (
      !this.started ||
      this.state.phase === "terminal" ||
      !this.state.room ||
      !this.resumeRequired
    )
      return;
    if (this.stableTimer !== undefined)
      this.options.timers.clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
    if (this.reconnectTimer !== undefined) return;
    if (!this.online || !this.visible) {
      this.setRecovery(!this.online ? "offline" : "hidden");
      return;
    }
    if (
      this.reconnectPolicy.attempt >= (this.options.maxReconnectAttempts ?? 6)
    ) {
      this.setRecovery("exhausted");
      return;
    }
    const attempt = this.reconnectPolicy.next();
    this.setRecovery("scheduled");
    this.reconnectTimer = this.options.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.retry();
    }, attempt.delayMs);
  }

  private setRememberedStatus(status: RememberedIdentityStatus) {
    this.transition({ type: "remembered-status", status });
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
