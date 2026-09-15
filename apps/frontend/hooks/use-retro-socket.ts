"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isValidRetroCode,
  type RetroCommand,
  type RetroRoom,
  type RetroRoomInfo,
  type RetroServerEvent,
} from "shared/retrospective";

import {
  clearRetroToken,
  readRetroToken,
  saveRetroToken,
} from "../lib/retro-session";
import { saveRetroHistory } from "../lib/retro-history";

type Connection = "connecting" | "connected" | "disconnected";
type Failure = { code: string; message: string };
type Pending = {
  id: string;
  resolve: (success: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

const INVALID_ROOM_CODE_MESSAGE =
  "That room link is invalid. Room codes use 1–64 letters, numbers, hyphens, or underscores.";

function pathRoomCode(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/retro\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** A private socket with a room-scoped cookie identity. Never replay mutations. */
export function useRetroSocket(initialCode?: string) {
  const socket = useRef<WebSocket | null>(null);
  const credentials = useRef<{ code: string; token: string } | null>(null);
  const inFlight = useRef<Pending | null>(null);
  const nextRequestId = useRef(0);
  const ready = useRef(false);
  const latestRoom = useRef<RetroRoom | null>(null);
  const inspectedCode = useRef<string | null>(null);
  const terminal = useRef(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [room, setRoom] = useState<RetroRoom | null>(null);
  const [roomInfo, setRoomInfo] = useState<RetroRoomInfo | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cookieSaved, setCookieSaved] = useState<boolean | null>(null);
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
    let client: WebSocket;
    const routeCode = initialCode ?? pathRoomCode();
    ready.current = false;
    if (routeCode && !isValidRetroCode(routeCode)) {
      // Do not open a socket for a malformed dynamic route. Apart from avoiding
      // a pointless connection, this prevents an invalid code from becoming a
      // server command through a programmatically supplied URL.
      terminal.current = true;
      // oxlint-disable-next-line react/set-state-in-effect
      setConnection("disconnected");
      setError({
        code: "invalid-room-code",
        message: INVALID_ROOM_CODE_MESSAGE,
      });
      setRoomInfo({
        code: routeCode,
        available: false,
        requiresPassword: false,
      });
      settle(false);
      return;
    }
    terminal.current = false;
    if (!credentials.current && !terminal.current) {
      const token = routeCode ? readRetroToken(routeCode) : null;
      if (routeCode && token) credentials.current = { code: routeCode, token };
    }
    try {
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
      client = new WebSocket(url.toString());
      socket.current = client;
    } catch {
      // Surface synchronous WebSocket construction/configuration failures to the UI.
      // oxlint-disable-next-line react/set-state-in-effect
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
      clearTimeout(timer);
      ready.current = false;
      setConnection("disconnected");
      setError({ code: "connection", message });
      settle(false);
      client.close();
    };
    const markUnavailable = () => {
      const code =
        inspectedCode.current ?? credentials.current?.code ?? routeCode;
      if (code && isValidRetroCode(code))
        setRoomInfo({ code, available: false, requiresPassword: false });
    };
    const timer = setTimeout(
      () => fail("Connection timed out. Retry to resume this session."),
      15000
    );
    const requestInspection = (code: string) => {
      inspectedCode.current = code;
      const requestId = String(++nextRequestId.current);
      setPending(true);
      inFlight.current = { id: requestId, resolve: () => {}, timer };
      try {
        client.send(
          JSON.stringify({
            event: "retro-command",
            data: { type: "inspect", code, requestId },
          })
        );
      } catch {
        fail("Could not check this room. Retry the connection.");
      }
    };
    client.onopen = () => {
      if (!active) return;
      if (credentials.current) {
        const requestId = String(++nextRequestId.current);
        setPending(true);
        inFlight.current = { id: requestId, resolve: () => {}, timer };
        try {
          client.send(
            JSON.stringify({
              event: "retro-command",
              data: { type: "resume", ...credentials.current, requestId },
            })
          );
        } catch {
          fail("Could not restore your session. Retry the connection.");
        }
      } else if (routeCode) {
        requestInspection(routeCode);
      } else {
        clearTimeout(timer);
        ready.current = true;
        setConnection("connected");
      }
    };
    client.onmessage = (message) => {
      if (!active || client.readyState !== WebSocket.OPEN) return;
      let event: RetroServerEvent;
      try {
        event = JSON.parse(message.data);
        if (event.event === "retro-room-info") {
          const responseRequestId = event.data?.requestId;
          if (
            typeof event.data?.code !== "string" ||
            !isValidRetroCode(event.data.code) ||
            typeof event.data.available !== "boolean" ||
            typeof event.data.requiresPassword !== "boolean" ||
            (responseRequestId !== undefined &&
              (typeof responseRequestId !== "string" ||
                responseRequestId.length > 64)) ||
            (inspectedCode.current && event.data.code !== inspectedCode.current)
          ) {
            throw new Error("Invalid room info");
          }
          if (
            inFlight.current &&
            responseRequestId !== undefined &&
            responseRequestId !== inFlight.current.id
          )
            return;
          setRoomInfo({
            code: event.data.code,
            available: event.data.available,
            requiresPassword: event.data.requiresPassword,
          });
          ready.current = true;
          setConnection("connected");
          setError(null);
          clearTimeout(timer);
          if (
            !inFlight.current ||
            !event.data.requestId ||
            event.data.requestId === inFlight.current.id
          ) {
            settle(true);
          }
        } else if (event.event === "retro-state") {
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
          inspectedCode.current = null;
          setRoomInfo(null);
          credentials.current = { code: snapshot.code, token: self.token };
          setCookieSaved(
            saveRetroToken(snapshot.code, self.token, snapshot.expiresAt)
          );
          setHistorySaved(saveRetroHistory(snapshot, self.id));
          latestRoom.current = snapshot;
          terminal.current = false;
          ready.current = true;
          setRoom(snapshot);
          setSelfId(self.id);
          setConnection("connected");
          clearTimeout(timer);
          // Native history keeps the mounted provider (and its resume token) alive.
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
          clearTimeout(timer);
          setError(event.data);
          settle(false);
          if (
            event.data.code === "room-expired" ||
            event.data.code === "invalid-session" ||
            event.data.code === "removed"
          ) {
            if (event.data.code === "room-expired") markUnavailable();
            // A live tab replaced by another tab must not delete their shared
            // valid cookie. Clear only rejected resume credentials or expired rooms.
            if (
              credentials.current &&
              (event.data.code === "room-expired" ||
                event.data.code === "removed" ||
                !ready.current)
            )
              clearRetroToken(credentials.current.code);
            terminal.current = true;
            ready.current = false;
            credentials.current = null;
            setSelfId(null);
            client.close();
            setConnection("disconnected");
          } else if (
            event.data.code === "room-closed" ||
            event.data.code === "capacity"
          ) {
            markUnavailable();
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
      clearTimeout(timer);
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
    return () => {
      active = false;
      clearTimeout(timer);
      client.onopen = null;
      client.onmessage = null;
      client.onerror = null;
      client.onclose = null;
      client.close();
      socket.current = null;
      ready.current = false;
      settle(false);
    };
  }, [attempt, initialCode, settle]);

  const send = useCallback(
    (command: RetroCommand): Promise<boolean> => {
      if (
        (command.type === "inspect" ||
          command.type === "join" ||
          command.type === "resume") &&
        !isValidRetroCode(command.code)
      ) {
        setError({
          code: "invalid-room-code",
          message: INVALID_ROOM_CODE_MESSAGE,
        });
        return Promise.resolve(false);
      }
      const client = socket.current;
      const snapshot = latestRoom.current;
      if (command.type === "inspect") {
        inspectedCode.current = command.code;
        setRoomInfo(null);
      }
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
        }
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
    setAttempt((value) => value + 1);
  }, []);

  return {
    room,
    roomInfo,
    selfId,
    connection,
    pending,
    error,
    send,
    retry,
    cookieSaved,
    historySaved,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
