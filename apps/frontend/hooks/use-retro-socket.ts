"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { RetroRoom } from "shared/retrospective";
import {
  RetroSessionClient,
  type RetroCredentialStorage,
  type RetroHistoryStorage,
  type RetroTimerStorage,
} from "../lib/retro-session-client";
import {
  createBrowserRetroNavigation,
  parseRetroRoomCode,
} from "../lib/retro-route";
import { saveRetroHistory } from "../lib/retro-history";
import {
  clearRetroToken,
  readRetroToken,
  saveRetroToken,
} from "../lib/retro-session";
import { WebSocketTransport } from "../lib/websocket-transport";

const browserCredentials: RetroCredentialStorage = {
  read: readRetroToken,
  save: saveRetroToken,
  clear: clearRetroToken,
};
const browserHistory: RetroHistoryStorage = {
  save: (room: RetroRoom, viewerId: string) => saveRetroHistory(room, viewerId),
};
const browserClock = { now: () => Date.now() };
const browserTimers: RetroTimerStorage = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
};

function retroWebSocketUrl(): string {
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
    return url.toString();
  } catch {
    // The session client turns an invalid URL into a user-visible configuration
    // state instead of throwing during React render.
    return "";
  }
}

/** Compose browser adapters, transport, and the protocol client for React. */
export function useRetroSocket(initialCode?: string) {
  const routeCode = useMemo(() => {
    if (initialCode !== undefined) return initialCode;
    if (typeof window === "undefined") return null;
    return parseRetroRoomCode(window.location.pathname);
  }, [initialCode]);
  const url = useMemo(() => retroWebSocketUrl(), []);
  const transport = useMemo(
    () => new WebSocketTransport({ url, queueWhileConnecting: false }),
    [url]
  );
  const client = useMemo(
    () =>
      new RetroSessionClient({
        transport,
        initialCode: routeCode,
        credentials: browserCredentials,
        history: browserHistory,
        clock: browserClock,
        timers: browserTimers,
        navigation: createBrowserRetroNavigation(),
      }),
    [routeCode, transport]
  );

  useEffect(() => {
    client.start();
    return () => client.dispose();
  }, [client]);

  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot
  );

  return {
    room: state.room,
    selfId: state.selfId,
    connection: state.connection,
    pending: state.pendingRequestId !== null,
    error: state.error,
    send: client.send,
    retry: client.retry,
    cookieSaved: state.cookieSaved,
    historySaved: state.historySaved,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
