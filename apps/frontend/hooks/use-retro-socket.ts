"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RetroCommand,
  RetroRoom,
  RetroServerEvent,
} from "shared/retrospective";

import {
  clearRetroToken,
  readRetroToken,
  saveRetroToken,
} from "../lib/retro-session";
import { saveRetroHistory } from "../lib/retro-history";
import {
  createRetroReconnectPolicy,
  type RetroReconnectPolicy,
  type RetroReconnectPolicyOptions,
} from "../lib/retro-reconnect-policy";

export type Connection = "connecting" | "connected" | "disconnected";
export type RetroRecovery =
  | "idle"
  | "connecting"
  | "scheduled"
  | "offline"
  | "hidden";
type Failure = { code: string; message: string };
type Timer = ReturnType<typeof setTimeout>;
type Pending = {
  id: string;
  resolve: (success: boolean) => void;
  timer: Timer;
};

export interface RetroSocketOptions {
  /** Injectable policy for deterministic reconnect lifecycle tests. */
  reconnectPolicy?: RetroReconnectPolicy;
  reconnect?: RetroReconnectPolicyOptions;
  /** Keep a connection open this long before resetting its retry backoff. */
  stableConnectionMs?: number;
  /** WebSocket handshake timeout; exposed so lifecycle tests need not wait. */
  connectionTimeoutMs?: number;
}

const UNCERTAIN_MUTATION_MESSAGE =
  "Connection lost before confirmation. Retry, then check the room before repeating your change.";
const DEFAULT_STABLE_CONNECTION_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;
const roomPath = /^\/retro\/([a-zA-Z0-9_-]{1,64})\/?$/;

function pathRoomCode(): string | null {
  return typeof window === "undefined"
    ? null
    : (window.location.pathname.match(roomPath)?.[1] ?? null);
}

function websocketUrl(): URL {
  const url = new URL(process.env.NEXT_PUBLIC_WS_URL ?? "");
  url.protocol =
    url.protocol === "https:"
      ? "wss:"
      : url.protocol === "http:"
        ? "ws:"
        : url.protocol;
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new Error("Invalid protocol");
  url.pathname = "/retro";
  url.search = "";
  url.hash = "";
  return url;
}

/** A private socket with a room-scoped cookie identity. Never replay mutations. */
export function useRetroSocket(options: RetroSocketOptions = {}) {
  const socket = useRef<WebSocket | null>(null);
  const credentials = useRef<{ code: string; token: string } | null>(null);
  const inFlight = useRef<Pending | null>(null);
  const nextRequestId = useRef(0);
  const ready = useRef(false);
  const latestRoom = useRef<RetroRoom | null>(null);
  const terminal = useRef(false);
  const mounted = useRef(false);
  const online = useRef(true);
  const visible = useRef(true);
  const reconnectTimer = useRef<Timer | null>(null);
  const connectionTimer = useRef<Timer | null>(null);
  const stableTimer = useRef<Timer | null>(null);
  const resumePending = useRef(false);
  const uncertainMutation = useRef(false);
  const connectRef = useRef<(() => void) | null>(null);
  const policy = useRef<RetroReconnectPolicy>(
    options.reconnectPolicy ?? createRetroReconnectPolicy(options.reconnect)
  );
  const stableConnectionMs = useRef(
    Math.max(0, options.stableConnectionMs ?? DEFAULT_STABLE_CONNECTION_MS)
  );
  const connectionTimeoutMs = useRef(
    Math.max(0, options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS)
  );

  const [connection, setConnection] = useState<Connection>("connecting");
  const [room, setRoom] = useState<RetroRoom | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [recovery, setRecovery] = useState<RetroRecovery>("idle");
  const [terminalState, setTerminalState] = useState(false);
  const [cookieSaved, setCookieSaved] = useState<boolean | null>(null);
  const [historySaved, setHistorySaved] = useState<boolean | null>(null);

  const settle = useCallback((success: boolean) => {
    if (inFlight.current) {
      clearTimeout(inFlight.current.timer);
      inFlight.current.resolve(success);
      inFlight.current = null;
    }
    if (mounted.current) setPending(false);
  }, []);

  useEffect(() => {
    let active = true;
    let client: WebSocket | null = null;
    mounted.current = true;
    online.current =
      typeof navigator === "undefined" || navigator.onLine !== false;
    visible.current =
      typeof document === "undefined" || document.visibilityState !== "hidden";
    terminal.current = false;
    policy.current.reset();

    if (!credentials.current) {
      const code = pathRoomCode();
      const token = code ? readRetroToken(code) : null;
      if (code && token) credentials.current = { code, token };
    }

    const clearReconnectTimer = () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    };
    const clearConnectionTimer = () => {
      if (connectionTimer.current) clearTimeout(connectionTimer.current);
      connectionTimer.current = null;
    };
    const clearStableTimer = () => {
      if (stableTimer.current) clearTimeout(stableTimer.current);
      stableTimer.current = null;
    };

    const scheduleReconnect = () => {
      if (!active || terminal.current || !credentials.current) return;
      if (
        latestRoom.current &&
        (latestRoom.current.phase === "closed" ||
          latestRoom.current.expiresAt <= Date.now())
      ) {
        terminal.current = true;
        setTerminalState(true);
        return;
      }
      if (!online.current) {
        setRecovery("offline");
        return;
      }
      if (!visible.current) {
        setRecovery("hidden");
        return;
      }
      if (reconnectTimer.current || socket.current) return;

      const next = policy.current.next();
      setReconnectAttempt(next.number);
      setRecovery("scheduled");
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        if (!active || terminal.current) return;
        if (!online.current) {
          setRecovery("offline");
          return;
        }
        if (!visible.current) {
          setRecovery("hidden");
          return;
        }
        connect();
      }, next.delayMs);
    };

    const markConnected = (connectedClient: WebSocket) => {
      clearConnectionTimer();
      ready.current = true;
      setConnection("connected");
      setRecovery("idle");
      if (stableTimer.current) return;
      stableTimer.current = setTimeout(() => {
        stableTimer.current = null;
        if (!active || socket.current !== connectedClient || !ready.current)
          return;
        policy.current.reset();
        setReconnectAttempt(0);
      }, stableConnectionMs.current);
    };

    const terminate = (
      connectedClient: WebSocket,
      failure: Failure,
      clearCredential: boolean
    ) => {
      if (clearCredential && credentials.current)
        clearRetroToken(credentials.current.code);
      // A replaced live tab intentionally keeps its cookie for the tab that
      // owns the replacement connection. `clearCredential` is false for that
      // case and true for rejected or removed credentials.
      clearReconnectTimer();
      clearConnectionTimer();
      clearStableTimer();
      terminal.current = true;
      setTerminalState(true);
      ready.current = false;
      resumePending.current = false;
      setConnection("disconnected");
      setRecovery("idle");
      setError(failure);
      settle(false);
      setSelfId(null);
      credentials.current = null;
      socket.current = null;
      connectedClient.close();
    };

    const disconnect = (disconnectedClient: WebSocket, message?: string) => {
      if (!active || socket.current !== disconnectedClient) return;
      clearConnectionTimer();
      clearStableTimer();
      ready.current = false;
      resumePending.current = false;
      if (inFlight.current) {
        // Resolve the caller, but deliberately discard the command. A resume
        // snapshot is the only safe recovery; it is never a mutation replay.
        uncertainMutation.current = true;
        setError({ code: "connection", message: UNCERTAIN_MUTATION_MESSAGE });
      } else if (message) {
        setError({ code: "connection", message });
      }
      settle(false);
      socket.current = null;
      setConnection("disconnected");
      disconnectedClient.close();
      if (credentials.current) scheduleReconnect();
    };

    const connect = () => {
      if (!active || terminal.current) return;
      if (
        latestRoom.current &&
        (latestRoom.current.phase === "closed" ||
          latestRoom.current.expiresAt <= Date.now())
      ) {
        terminal.current = true;
        setTerminalState(true);
        setConnection("disconnected");
        setRecovery("idle");
        return;
      }
      if (!online.current) {
        setConnection("disconnected");
        setRecovery("offline");
        return;
      }
      if (!visible.current) {
        setConnection("disconnected");
        setRecovery("hidden");
        return;
      }
      if (socket.current) {
        if (
          socket.current.readyState === WebSocket.CLOSED ||
          socket.current.readyState === WebSocket.CLOSING
        )
          socket.current = null;
        else return;
      }

      try {
        client = new WebSocket(websocketUrl().toString());
        socket.current = client;
      } catch {
        setConnection("disconnected");
        setRecovery("idle");
        setError({
          code: "configuration",
          message:
            "Could not connect. Check the NEXT_PUBLIC_WS_URL configuration.",
        });
        return;
      }

      const connectedClient = client;
      let finished = false;
      const fail = (message?: string) => {
        if (finished) return;
        finished = true;
        disconnect(connectedClient, message);
      };
      const terminalClose = (failure: Failure, clearCredential: boolean) => {
        if (finished) return;
        finished = true;
        terminate(connectedClient, failure, clearCredential);
      };

      ready.current = false;
      resumePending.current = !!credentials.current;
      setConnection("connecting");
      setRecovery("connecting");
      connectionTimer.current = setTimeout(
        () => fail("Connection timed out. Retry to resume this session."),
        connectionTimeoutMs.current
      );

      connectedClient.onopen = () => {
        if (!active || socket.current !== connectedClient) return;
        if (credentials.current) {
          resumePending.current = true;
          setPending(true);
          try {
            connectedClient.send(
              JSON.stringify({
                event: "retro-command",
                data: { type: "resume", ...credentials.current },
              })
            );
          } catch {
            fail("Could not restore your session. Retry the connection.");
          }
        } else {
          resumePending.current = false;
          markConnected(connectedClient);
          if (!uncertainMutation.current) setError(null);
        }
      };
      connectedClient.onmessage = (message) => {
        if (
          !active ||
          socket.current !== connectedClient ||
          connectedClient.readyState !== WebSocket.OPEN
        )
          return;
        let event: RetroServerEvent;
        try {
          event = JSON.parse(message.data);
          if (event.event === "retro-state") {
            if (
              !event.data?.self?.id ||
              !event.data.self.token ||
              !event.data.room?.code ||
              !Array.isArray(event.data.room.notes) ||
              !Array.isArray(event.data.room.groups) ||
              !Array.isArray(event.data.room.members) ||
              !Array.isArray(event.data.room.actions) ||
              !Number.isFinite(event.data.room.expiresAt)
            ) {
              throw new Error("Invalid snapshot");
            }
            const { room: snapshot, self } = event.data;
            credentials.current = { code: snapshot.code, token: self.token };
            setCookieSaved(
              saveRetroToken(snapshot.code, self.token, snapshot.expiresAt)
            );
            setHistorySaved(saveRetroHistory(snapshot, self.id));
            latestRoom.current = snapshot;
            const wasResuming = resumePending.current;
            resumePending.current = false;
            if (wasResuming && !inFlight.current) setPending(false);
            if (snapshot.phase === "closed") {
              // A closed room is immutable. Keep retained credentials usable
              // for read-only resume, but do not auto-retry its socket.
              terminal.current = true;
              setTerminalState(true);
            }
            setRoom(snapshot);
            setSelfId(self.id);
            markConnected(connectedClient);
            // Native history keeps the mounted provider (and its resume token)
            // alive. A snapshot after a reconnect is authoritative, but it is
            // not an acknowledgement for a discarded mutation.
            const path = `/retro/${encodeURIComponent(snapshot.code)}`;
            if (window.location.pathname !== path)
              window.history.replaceState(null, "", path);
            if (!inFlight.current) setPending(false);
            if (
              !uncertainMutation.current &&
              (!inFlight.current ||
                event.data.requestId === inFlight.current.id)
            ) {
              setError(null);
              settle(true);
            } else if (
              inFlight.current &&
              event.data.requestId === inFlight.current.id
            ) {
              settle(true);
            }
          } else if (event.event === "retro-error") {
            if (
              typeof event.data?.code !== "string" ||
              typeof event.data.message !== "string"
            )
              throw new Error("Invalid error");
            const failure = event.data;
            const terminalFailure =
              failure.code === "room-expired" ||
              failure.code === "invalid-session" ||
              failure.code === "removed";
            clearConnectionTimer();
            if (!uncertainMutation.current || terminalFailure)
              setError(failure);
            settle(false);
            if (terminalFailure) {
              terminalClose(
                failure,
                failure.code === "room-expired" ||
                  failure.code === "removed" ||
                  !ready.current
              );
            } else if (!ready.current) {
              // A failed resume must not enable edits on a stale snapshot.
              fail();
            }
          }
        } catch {
          fail(
            "Received an invalid response. Retry to get a fresh room snapshot."
          );
        }
      };
      connectedClient.onerror = () =>
        fail(
          "Unable to reach the retrospective server. Retry when your connection is available."
        );
      connectedClient.onclose = (event) => {
        if (!active || socket.current !== connectedClient || finished) return;
        if (event.code === 4001) {
          terminalClose(
            {
              code: "invalid-session",
              message: "Your session was resumed in another connection.",
            },
            false
          );
        } else if (event.code === 4003) {
          terminalClose(
            {
              code: "removed",
              message: "A moderator removed you from this retrospective.",
            },
            true
          );
        } else {
          fail();
        }
      };
    };
    connectRef.current = connect;

    const handleOffline = () => {
      online.current = false;
      clearReconnectTimer();
      const current = socket.current;
      if (current) disconnect(current);
      else {
        setConnection("disconnected");
        setRecovery("offline");
      }
    };
    const handleOnline = () => {
      online.current = true;
      if (!active || terminal.current) return;
      clearReconnectTimer();
      if (!visible.current) {
        setConnection("disconnected");
        setRecovery("hidden");
        return;
      }
      connect();
    };
    const handleVisibility = () => {
      visible.current = document.visibilityState !== "hidden";
      if (!active || terminal.current) return;
      if (!visible.current) {
        clearReconnectTimer();
        if (!socket.current) {
          setConnection("disconnected");
          setRecovery("hidden");
        }
        return;
      }
      if (!online.current) {
        setConnection("disconnected");
        setRecovery("offline");
      } else connect();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    if (!online.current) {
      setConnection("disconnected");
      setRecovery("offline");
    } else if (!visible.current) {
      setConnection("disconnected");
      setRecovery("hidden");
    } else {
      connect();
    }

    return () => {
      active = false;
      mounted.current = false;
      connectRef.current = null;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearReconnectTimer();
      clearConnectionTimer();
      clearStableTimer();
      const current = socket.current;
      socket.current = null;
      if (current) {
        current.onopen = null;
        current.onmessage = null;
        current.onerror = null;
        current.onclose = null;
        current.close();
      }
      ready.current = false;
      resumePending.current = false;
      settle(false);
    };
  }, [settle]);

  const send = useCallback(
    (command: RetroCommand): Promise<boolean> => {
      const client = socket.current;
      const snapshot = latestRoom.current;
      if (
        !ready.current ||
        terminal.current ||
        inFlight.current ||
        client?.readyState !== WebSocket.OPEN
      )
        return Promise.resolve(false);
      if (
        snapshot &&
        (snapshot.phase === "closed" || snapshot.expiresAt <= Date.now())
      )
        return Promise.resolve(false);
      if (command.type === "join") {
        const token = readRetroToken(command.code);
        if (token) {
          credentials.current = { code: command.code, token };
          command = { type: "resume", ...credentials.current };
          ready.current = false;
          resumePending.current = true;
        }
      }
      uncertainMutation.current = false;
      setPending(true);
      setError(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!inFlight.current) return;
          uncertainMutation.current = true;
          ready.current = false;
          setConnection("disconnected");
          setRecovery(credentials.current ? "scheduled" : "idle");
          setError({
            code: "timeout",
            message:
              "No confirmation received. Retry to refresh the room before repeating your change.",
          });
          settle(false);
          client.close();
        }, 15_000);
        const requestId = String(++nextRequestId.current);
        inFlight.current = { id: requestId, resolve, timer };
        try {
          client.send(
            JSON.stringify({
              event: "retro-command",
              data: { ...command, requestId },
            })
          );
        } catch {
          clearTimeout(timer);
          inFlight.current = null;
          setConnection("disconnected");
          setError({
            code: "connection",
            message: "Could not send your change. Retry the connection first.",
          });
          settle(false);
          client.close();
        }
      });
    },
    [settle]
  );

  const retry = useCallback(() => {
    if (terminal.current || !mounted.current) return;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    if (!online.current) {
      setConnection("disconnected");
      setRecovery("offline");
      return;
    }
    if (!visible.current) {
      setConnection("disconnected");
      setRecovery("hidden");
      return;
    }
    if (inFlight.current) {
      uncertainMutation.current = true;
      setError({ code: "connection", message: UNCERTAIN_MUTATION_MESSAGE });
      settle(false);
    }
    const current = socket.current;
    if (current) {
      if (current.readyState === WebSocket.OPEN && ready.current) return;
      socket.current = null;
      if (connectionTimer.current) clearTimeout(connectionTimer.current);
      connectionTimer.current = null;
      if (stableTimer.current) clearTimeout(stableTimer.current);
      stableTimer.current = null;
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      current.close();
    }
    if (!uncertainMutation.current) setError(null);
    setConnection("connecting");
    setRecovery("connecting");
    connectRef.current?.();
  }, []);

  return {
    room,
    selfId,
    connection,
    pending,
    error,
    send,
    retry,
    reconnectAttempt,
    recovery,
    terminal: terminalState,
    cookieSaved,
    historySaved,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
