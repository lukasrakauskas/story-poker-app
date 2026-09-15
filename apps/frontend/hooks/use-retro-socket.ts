"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { RetroRoom } from "shared/retrospective";
import {
  RetroSessionClient,
  type RetroHistoryStorage,
  type RetroSessionApi,
  type RetroTimerStorage,
} from "../lib/retro-session-client";
import {
  createBrowserRetroNavigation,
  parseRetroRoomCode,
} from "../lib/retro-route";
import { saveRetroHistory } from "../lib/retro-history";
import {
  establishRetroSession,
  forgetRetroSession,
  inspectRetroSession,
  resumeRetroSession,
} from "../lib/retro-session";
import { WebSocketTransport } from "../lib/websocket-transport";

const browserSessions: RetroSessionApi = {
  establish: establishRetroSession,
  inspect: inspectRetroSession,
  resume: resumeRetroSession,
  forget: forgetRetroSession,
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
    const configured =
      process.env.NEXT_PUBLIC_WS_URL ??
      (typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:4000");
    const url = new URL(configured);
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
        sessions: browserSessions,
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
    roomInfo: state.roomInfo,
    selfId: state.selfId,
    connection: state.connection,
    pending: state.pendingRequestId !== null,
    error: state.error,
    send: client.send,
    retry: client.retry,
    cookieSaved: state.cookieSaved,
    historySaved: state.historySaved,
    rememberedIdentity: state.rememberedIdentity,
    rememberedStatus: state.rememberedStatus,
    inspectRemembered: client.inspectRemembered,
    continueRememberedSession: client.continueRememberedSession,
    forgetRememberedSession: client.forgetRememberedSession,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
