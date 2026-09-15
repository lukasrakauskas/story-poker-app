"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RetroCommand,
  RetroRememberedIdentity,
  RetroRoom,
  RetroServerEvent,
} from "shared/retrospective";

import {
  clearRetroToken,
  readRetroToken,
  saveRetroToken,
} from "../lib/retro-session";
import { saveRetroHistory } from "../lib/retro-history";

type Connection = "connecting" | "connected" | "disconnected";
type Failure = { code: string; message: string };
type RequestKind = RetroCommand["type"];
type Pending = {
  id: string;
  kind: RequestKind;
  resolve: (success: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type RememberedIdentityStatus =
  | "idle"
  | "checking"
  | "valid"
  | "resuming"
  | "invalid"
  | "forgotten";

const ROOM_PATH = /^\/retro\/([a-zA-Z0-9_-]{1,64})\/?$/;
const REPLACED_SESSION_MESSAGE =
  "Your session was resumed in another connection.";
const INVALID_SAVED_SESSION_MESSAGE =
  "This saved session could not be verified. Join as someone else.";

function pathRoomCode(initialCode?: string): string | null {
  if (initialCode) return initialCode;
  if (typeof window === "undefined") return null;
  return window.location.pathname.match(ROOM_PATH)?.[1] ?? null;
}

function isEntryCommand(command: RetroCommand): boolean {
  return (
    command.type === "create" ||
    command.type === "join" ||
    command.type === "resume" ||
    command.type === "inspect" ||
    command.type === "forget"
  );
}

/** A private socket with explicit remembered-identity resumption. */
export function useRetroSocket(initialCode?: string) {
  const socket = useRef<WebSocket | null>(null);
  const credentials = useRef<{ code: string; token: string } | null>(null);
  const inFlight = useRef<Pending | null>(null);
  const nextRequestId = useRef(0);
  const ready = useRef(false);
  const latestRoom = useRef<RetroRoom | null>(null);
  const terminal = useRef(false);
  const resumeOnConnect = useRef(false);
  const rememberedIdentityRef = useRef<RetroRememberedIdentity | null>(null);
  const rememberedInspectionResult = useRef<"valid" | "invalid" | "none">(
    "none"
  );
  const operationCode = useRef<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [room, setRoom] = useState<RetroRoom | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cookieSaved, setCookieSaved] = useState<boolean | null>(null);
  const [historySaved, setHistorySaved] = useState<boolean | null>(null);
  const [rememberedIdentity, setRememberedIdentity] =
    useState<RetroRememberedIdentity | null>(null);
  const [rememberedStatus, setRememberedStatus] =
    useState<RememberedIdentityStatus>("idle");

  const settle = useCallback((success: boolean) => {
    if (inFlight.current) {
      clearTimeout(inFlight.current.timer);
      inFlight.current.resolve(success);
      inFlight.current = null;
    }
    setPending(false);
  }, []);

  const clearRememberedIdentity = useCallback(
    (status: RememberedIdentityStatus = "idle") => {
      rememberedIdentityRef.current = null;
      setRememberedIdentity(null);
      setRememberedStatus(status);
    },
    []
  );

  /** Send one request and wait for its addressed acknowledgement. */
  const sendCommand = useCallback(
    (command: RetroCommand, bypassReady = false): Promise<boolean> => {
      const client = socket.current;
      const snapshot = latestRoom.current;
      if (
        (!bypassReady &&
          (!ready.current || terminal.current || inFlight.current)) ||
        client?.readyState !== WebSocket.OPEN
      )
        return Promise.resolve(false);
      if (
        snapshot &&
        !isEntryCommand(command) &&
        (snapshot.phase === "closed" || snapshot.expiresAt <= Date.now())
      )
        return Promise.resolve(false);

      if (command.type === "resume") {
        credentials.current = { code: command.code, token: command.token };
        resumeOnConnect.current = true;
        operationCode.current = command.code;
        ready.current = false;
        setRememberedStatus("resuming");
      } else if (command.type === "inspect") {
        credentials.current = { code: command.code, token: command.token };
        resumeOnConnect.current = false;
        operationCode.current = command.code;
        ready.current = false;
        setRememberedStatus("checking");
      } else if (command.type === "forget") {
        operationCode.current = command.code;
        ready.current = false;
      }

      setPending(true);
      setError(null);
      return new Promise((resolve) => {
        const requestId = String(++nextRequestId.current);
        const timer = setTimeout(() => {
          if (!inFlight.current || inFlight.current.id !== requestId) return;
          ready.current = false;
          setConnection("disconnected");
          setError({
            code: "timeout",
            message:
              "No confirmation received. Retry to refresh the room before repeating your change.",
          });
          settle(false);
          client?.close();
        }, 15000);
        inFlight.current = {
          id: requestId,
          kind: command.type,
          resolve,
          timer,
        };
        try {
          client?.send(
            JSON.stringify({
              event: "retro-command",
              data: { ...command, requestId },
            })
          );
        } catch {
          clearTimeout(timer);
          inFlight.current = null;
          ready.current = false;
          setConnection("disconnected");
          setError({
            code: "connection",
            message: "Could not send your change. Retry the connection first.",
          });
          setPending(false);
          resolve(false);
          client?.close();
        }
      });
    },
    [settle]
  );

  useEffect(() => {
    let active = true;
    let client: WebSocket;
    const code = pathRoomCode(initialCode);
    ready.current = false;

    // A provider can survive a client-side navigation. Never carry an old
    // room's credential or snapshot into a different room entry point.
    if (credentials.current && credentials.current.code !== code) {
      credentials.current = null;
      operationCode.current = null;
      resumeOnConnect.current = false;
      terminal.current = false;
      latestRoom.current = null;
      clearRememberedIdentity();
      setRoom(null);
      setSelfId(null);
    }

    if (!credentials.current && code) {
      const token = readRetroToken(code);
      if (token) {
        credentials.current = { code, token };
        operationCode.current = code;
        rememberedInspectionResult.current = "none";
        resumeOnConnect.current = false;
        // A route cookie is an external credential that must be inspected before
        // the first socket can be made ready for entry.
        // oxlint-disable-next-line react/set-state-in-effect
        setRememberedStatus("checking");
      }
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
      ready.current = false;
      setConnection("disconnected");
      setError({ code: "connection", message });
      settle(false);
      client.close();
    };
    const timer = setTimeout(
      () => fail("Connection timed out. Retry to resume this session."),
      15000
    );

    client.onopen = () => {
      if (!active) return;
      if (credentials.current) {
        const credential = credentials.current;
        // Initial route entry and code-based joins inspect only. A resume is
        // sent here solely after this tab had already established a session.
        const command: RetroCommand = resumeOnConnect.current
          ? { type: "resume", ...credential }
          : { type: "inspect", ...credential };
        void sendCommand(command, true);
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
        if (event.event === "retro-identity") {
          if (
            typeof event.data?.code !== "string" ||
            typeof event.data.name !== "string" ||
            typeof event.data.moderator !== "boolean" ||
            (operationCode.current && event.data.code !== operationCode.current)
          )
            throw new Error("Invalid identity");
          const identity = {
            code: event.data.code,
            name: event.data.name,
            moderator: event.data.moderator,
          };
          rememberedIdentityRef.current = identity;
          rememberedInspectionResult.current = "valid";
          setRememberedIdentity(identity);
          setRememberedStatus("valid");
          ready.current = true;
          terminal.current = false;
          setConnection("connected");
          clearTimeout(timer);
          if (
            !inFlight.current ||
            event.data.requestId === inFlight.current.id
          ) {
            setError(null);
            settle(true);
          }
        } else if (event.event === "retro-forgotten") {
          if (
            typeof event.data?.code !== "string" ||
            (operationCode.current && event.data.code !== operationCode.current)
          )
            throw new Error("Invalid forgotten response");
          clearRetroToken(event.data.code);
          if (credentials.current?.code === event.data.code)
            credentials.current = null;
          resumeOnConnect.current = false;
          operationCode.current = null;
          rememberedInspectionResult.current = "none";
          clearRememberedIdentity("forgotten");
          ready.current = true;
          terminal.current = false;
          setConnection("connected");
          clearTimeout(timer);
          if (
            !inFlight.current ||
            event.data.requestId === inFlight.current.id
          ) {
            setError(null);
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
          credentials.current = { code: snapshot.code, token: self.token };
          operationCode.current = snapshot.code;
          resumeOnConnect.current = true;
          clearRememberedIdentity("idle");
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
          const operation = inFlight.current?.kind;
          const codeForCredential = operationCode.current;
          const replaced =
            event.data.code === "invalid-session" &&
            event.data.message === REPLACED_SESSION_MESSAGE;
          const inspecting = operation === "inspect";
          const forgetting = operation === "forget";

          if (
            (inspecting || forgetting) &&
            event.data.code === "invalid-session"
          ) {
            if (codeForCredential) clearRetroToken(codeForCredential);
            if (credentials.current?.code === codeForCredential)
              credentials.current = null;
            resumeOnConnect.current = false;
            operationCode.current = null;
            if (inspecting) rememberedInspectionResult.current = "invalid";
            clearRememberedIdentity("invalid");
            ready.current = true;
            terminal.current = false;
            setConnection("connected");
            setError({
              code: "invalid-session",
              message: inspecting
                ? INVALID_SAVED_SESSION_MESSAGE
                : "This saved session is no longer available. Join as someone else.",
            });
            settle(false);
          } else if (
            event.data.code === "room-expired" ||
            event.data.code === "invalid-session" ||
            event.data.code === "removed"
          ) {
            // A live tab replaced by another tab must not delete their shared
            // valid cookie. Rejected/expired/removed credentials are cleared
            // only for this room; replacement has its own distinct message.
            if (
              credentials.current &&
              !replaced &&
              (event.data.code === "room-expired" ||
                event.data.code === "removed" ||
                !ready.current)
            )
              clearRetroToken(credentials.current.code);
            if (!replaced) clearRememberedIdentity("invalid");
            terminal.current = true;
            ready.current = false;
            credentials.current = null;
            resumeOnConnect.current = false;
            operationCode.current = null;
            setSelfId(null);
            client.close();
            setConnection("disconnected");
            setError(event.data);
            settle(false);
          } else if (!ready.current) {
            // A failed resume must not enable edits on a stale snapshot.
            client.close();
            setConnection("disconnected");
            setError(event.data);
            settle(false);
          } else {
            setError(event.data);
            settle(false);
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
  }, [initialCode, attempt, clearRememberedIdentity, sendCommand, settle]);

  const send = useCallback(
    (command: RetroCommand): Promise<boolean> => sendCommand(command),
    [sendCommand]
  );

  const inspectRemembered = useCallback(
    async (code: string): Promise<"valid" | "invalid" | "none"> => {
      const token = readRetroToken(code);
      if (!token) {
        if (rememberedIdentityRef.current?.code === code)
          clearRememberedIdentity();
        return "none";
      }
      if (rememberedIdentityRef.current?.code === code) return "valid";
      credentials.current = { code, token };
      resumeOnConnect.current = false;
      operationCode.current = code;
      rememberedInspectionResult.current = "none";
      setRememberedStatus("checking");
      await sendCommand({ type: "inspect", code, token });
      return rememberedInspectionResult.current;
    },
    [clearRememberedIdentity, sendCommand]
  );

  const continueRememberedSession = useCallback(
    (code?: string): Promise<boolean> => {
      const targetCode =
        code ??
        rememberedIdentityRef.current?.code ??
        credentials.current?.code ??
        pathRoomCode(initialCode);
      if (!targetCode) return Promise.resolve(false);
      const token =
        credentials.current?.code === targetCode
          ? credentials.current.token
          : readRetroToken(targetCode);
      if (!token) {
        clearRetroToken(targetCode);
        clearRememberedIdentity("invalid");
        setError({
          code: "invalid-session",
          message: INVALID_SAVED_SESSION_MESSAGE,
        });
        return Promise.resolve(false);
      }
      credentials.current = { code: targetCode, token };
      resumeOnConnect.current = true;
      operationCode.current = targetCode;
      setRememberedStatus("resuming");
      return sendCommand({ type: "resume", code: targetCode, token });
    },
    [clearRememberedIdentity, initialCode, sendCommand]
  );

  const forgetRememberedSession = useCallback(
    (code?: string): Promise<boolean> => {
      const targetCode =
        code ??
        rememberedIdentityRef.current?.code ??
        credentials.current?.code ??
        pathRoomCode(initialCode);
      if (!targetCode) return Promise.resolve(false);
      const token =
        credentials.current?.code === targetCode
          ? credentials.current.token
          : readRetroToken(targetCode);
      if (!token) {
        clearRetroToken(targetCode);
        clearRememberedIdentity("forgotten");
        return Promise.resolve(true);
      }
      return sendCommand({ type: "forget", code: targetCode, token });
    },
    [clearRememberedIdentity, initialCode, sendCommand]
  );

  return {
    room,
    selfId,
    connection,
    pending,
    error,
    send,
    retry: () => {
      if (terminal.current) return;
      ready.current = false;
      setConnection("connecting");
      setError(null);
      setAttempt((value) => value + 1);
    },
    cookieSaved,
    historySaved,
    rememberedIdentity,
    rememberedStatus,
    inspectRemembered,
    continueRememberedSession,
    forgetRememberedSession,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
