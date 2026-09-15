"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RetroCommand,
  RetroRoom,
  RetroServerEvent,
} from "shared/retrospective";

import {
  establishRetroSession,
  forgetRetroSession,
  resumeRetroSession,
  RetroSessionError,
} from "../lib/retro-session";
import { saveRetroHistory } from "../lib/retro-history";

type Connection = "connecting" | "connected" | "disconnected";
type Failure = { code: string; message: string };
type Pending = {
  id: string;
  resolve: (success: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

const roomPath = /^\/retro\/([a-zA-Z0-9_-]{1,64})\/?$/;

function pathRoomCode(): string | null {
  return typeof window === "undefined"
    ? null
    : (window.location.pathname.match(roomPath)?.[1] ?? null);
}

/** A private socket authenticated by the backend's room-scoped HttpOnly cookie. */
export function useRetroSocket() {
  const socket = useRef<WebSocket | null>(null);
  const inFlight = useRef<Pending | null>(null);
  const nextRequestId = useRef(0);
  const ready = useRef(false);
  const latestRoom = useRef<RetroRoom | null>(null);
  const terminal = useRef(false);
  const desiredCode = useRef<string | null | undefined>(undefined);
  const skipNextHttpResume = useRef<string | null>(null);
  // React Strict Mode can start two effects while the first HTTP request is
  // still in flight. Reusing the prepared request prevents the second effect
  // from presenting the just-rotated cookie and losing the session.
  const preparedResume = useRef<{
    code: string;
    promise: ReturnType<typeof resumeRetroSession>;
  } | null>(null);
  const restarting = useRef(false);
  const mounted = useRef(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [room, setRoom] = useState<RetroRoom | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [historySaved, setHistorySaved] = useState<boolean | null>(null);

  const settle = useCallback((success: boolean) => {
    if (inFlight.current) {
      clearTimeout(inFlight.current.timer);
      inFlight.current.resolve(success);
      inFlight.current = null;
    }
    setPending(false);
  }, []);

  useEffect(() => {
    let active = true;
    let client: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    mounted.current = true;
    if (desiredCode.current === undefined) desiredCode.current = pathRoomCode();
    const code = desiredCode.current;
    let authenticated = false;
    let preserveLobbyFailure = false;

    const connect = async () => {
      if (code) {
        if (skipNextHttpResume.current === code) {
          // Keep this marker through React Strict Mode's effect replay. It is
          // cleared only after the new socket has authenticated, so the
          // replay cannot rotate the freshly established cookie again.
          authenticated = true;
        } else {
          try {
            const prepared =
              preparedResume.current?.code === code
                ? preparedResume.current.promise
                : resumeRetroSession(code);
            if (!preparedResume.current || preparedResume.current.code !== code)
              preparedResume.current = { code, promise: prepared };
            await prepared;
            authenticated = true;
          } catch (cause) {
            if (!active) return;
            const failure =
              cause instanceof RetroSessionError
                ? cause
                : new RetroSessionError(
                    "connection",
                    0,
                    "Unable to restore this retrospective session."
                  );
            if (
              failure.code === "session-required" ||
              (failure.code === "invalid-session" && !latestRoom.current)
            ) {
              // A room link without a usable remembered session is still a
              // valid join entry point. Leave the socket anonymous for lobby
              // entry; joining overwrites only this room's invalid cookie.
              authenticated = false;
              preserveLobbyFailure = failure.code === "invalid-session";
              terminal.current = false;
              if (preserveLobbyFailure)
                setError({ code: failure.code, message: failure.message });
            } else {
              terminal.current = ![
                "connection",
                "configuration",
                "timeout",
              ].includes(failure.code);
              ready.current = false;
              setConnection("disconnected");
              setError({ code: failure.code, message: failure.message });
              settle(false);
              return;
            }
          }
        }
      }
      if (!active) return;
      try {
        const configured = process.env.NEXT_PUBLIC_WS_URL;
        const base =
          configured ||
          (typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:4000");
        const url = new URL(base);
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
        client = new WebSocket(url.toString());
        socket.current = client;
      } catch {
        setConnection("disconnected");
        setError({
          code: "configuration",
          message:
            "Could not connect. Check the NEXT_PUBLIC_WS_URL configuration.",
        });
        return;
      }

      const fail = (message: string) => {
        if (!active) return;
        if (timer) clearTimeout(timer);
        ready.current = false;
        setConnection("disconnected");
        setError({ code: "connection", message });
        settle(false);
        client?.close();
      };
      timer = setTimeout(
        () => fail("Connection timed out. Retry to resume this session."),
        15000
      );
      client.onopen = () => {
        if (!active || !client) return;
        if (authenticated && code) {
          setPending(true);
          ready.current = false;
          try {
            const requestId = inFlight.current?.id;
            client.send(
              JSON.stringify({
                event: "retro-command",
                data: {
                  type: "resume",
                  code,
                  ...(requestId ? { requestId } : {}),
                },
              })
            );
          } catch {
            fail("Could not restore your session. Retry the connection.");
          }
        } else {
          if (timer) clearTimeout(timer);
          ready.current = true;
          setConnection("connected");
          if (!preserveLobbyFailure) setError(null);
        }
      };
      client.onmessage = (message) => {
        if (!active || !client || client.readyState !== WebSocket.OPEN) return;
        let event: RetroServerEvent;
        try {
          event = JSON.parse(message.data);
          if (event.event === "retro-state") {
            if (
              !event.data?.self?.id ||
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
            if (code && snapshot.code !== code)
              throw new Error("Snapshot room mismatch");
            setHistorySaved(saveRetroHistory(snapshot, self.id));
            latestRoom.current = snapshot;
            desiredCode.current = snapshot.code;
            if (skipNextHttpResume.current === snapshot.code)
              skipNextHttpResume.current = null;
            terminal.current = false;
            ready.current = true;
            setRoom(snapshot);
            setSelfId(self.id);
            setConnection("connected");
            if (timer) clearTimeout(timer);
            // Native history keeps the mounted provider alive across the room URL update.
            const path = `/retro/${encodeURIComponent(snapshot.code)}`;
            if (window.location.pathname !== path)
              window.history.replaceState(null, "", path);
            // Other participants' broadcasts are updates, not acknowledgements.
            if (
              !inFlight.current ||
              event.data.requestId === inFlight.current.id
            ) {
              setError(null);
              settle(true);
            }
          } else if (event.event === "retro-error") {
            if (
              typeof event.data?.code !== "string" ||
              typeof event.data.message !== "string"
            )
              throw new Error("Invalid error");
            if (timer) clearTimeout(timer);
            setError(event.data);
            settle(false);
            if (
              event.data.code === "room-expired" ||
              event.data.code === "invalid-session" ||
              event.data.code === "removed"
            ) {
              // HttpOnly cookies cannot be cleared by a displaced tab. This is
              // intentional: an old socket must not erase another tab's cookie.
              terminal.current = true;
              ready.current = false;
              setSelfId(null);
              client.close();
              setConnection("disconnected");
            } else if (event.data.code === "session-required") {
              ready.current = true;
              terminal.current = false;
              setConnection("connected");
              setError(null);
            } else if (!ready.current) {
              // A failed resume must not enable edits on a stale snapshot.
              client.close();
              setConnection("disconnected");
            }
          }
        } catch {
          fail(
            "Received an invalid response. Retry to get a fresh room snapshot."
          );
        }
      };
      client.onerror = () =>
        fail(
          "Unable to reach the retrospective server. Retry when your connection is available."
        );
      client.onclose = () => {
        if (!active) return;
        if (timer) clearTimeout(timer);
        ready.current = false;
        setConnection("disconnected");
        if (inFlight.current)
          setError({
            code: "connection",
            message:
              "Connection lost before confirmation. Retry, then check the room before repeating your change.",
          });
        settle(false);
      };
    };
    void connect();

    return () => {
      active = false;
      mounted.current = false;
      if (timer) clearTimeout(timer);
      if (client) {
        client.onopen = null;
        client.onmessage = null;
        client.onerror = null;
        client.onclose = null;
        client.close();
      }
      if (socket.current === client) socket.current = null;
      ready.current = false;
      if (!restarting.current) settle(false);
      else restarting.current = false;
    };
  }, [attempt, settle]);

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

      if (command.type === "create" || command.type === "join") {
        setPending(true);
        setError(null);
        ready.current = false;
        const requestId = String(++nextRequestId.current);
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            ready.current = false;
            setConnection("disconnected");
            setError({
              code: "timeout",
              message:
                "No confirmation received. Retry to refresh the room before repeating your change.",
            });
            settle(false);
            client.close();
          }, 15000);
          inFlight.current = { id: requestId, resolve, timer };
          void establishRetroSession(command)
            .then((view) => {
              if (!mounted.current) {
                settle(false);
                return;
              }
              desiredCode.current = view.room.code;
              preparedResume.current = null;
              skipNextHttpResume.current = view.room.code;
              terminal.current = false;
              restarting.current = true;
              setConnection("connecting");
              setAttempt((value) => value + 1);
            })
            .catch((cause) => {
              const failure =
                cause instanceof RetroSessionError
                  ? cause
                  : new RetroSessionError(
                      "connection",
                      0,
                      "Unable to establish the retrospective session."
                    );
              ready.current = true;
              setConnection("connected");
              setError({ code: failure.code, message: failure.message });
              settle(false);
            });
        });
      }

      setPending(true);
      setError(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          ready.current = false;
          setConnection("disconnected");
          setError({
            code: "timeout",
            message:
              "No confirmation received. Retry to refresh the room before repeating your change.",
          });
          settle(false);
          client.close();
        }, 15000);
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
          ready.current = false;
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
    if (terminal.current) return;
    ready.current = false;
    setConnection("connecting");
    setError(null);
    preparedResume.current = null;
    skipNextHttpResume.current = null;
    restarting.current = true;
    setAttempt((value) => value + 1);
  }, []);

  const forgetSession = useCallback(async (): Promise<boolean> => {
    const code = latestRoom.current?.code ?? desiredCode.current;
    if (!code) return false;
    try {
      const forgotten = await forgetRetroSession(code);
      if (!forgotten) return false;
      terminal.current = true;
      ready.current = false;
      setSelfId(null);
      setError({
        code: "invalid-session",
        message: "This browser session was forgotten. Join again to reconnect.",
      });
      socket.current?.close();
      setConnection("disconnected");
      return true;
    } catch (cause) {
      const failure =
        cause instanceof RetroSessionError
          ? cause
          : new RetroSessionError(
              "connection",
              0,
              "Unable to forget this browser session."
            );
      setError({ code: failure.code, message: failure.message });
      return false;
    }
  }, []);

  return {
    room,
    selfId,
    connection,
    pending,
    error,
    send,
    retry,
    forgetSession,
    historySaved,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
