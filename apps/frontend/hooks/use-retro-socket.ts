"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  RetroSessionClient,
  type RetroSessionApi,
  type RetroTimerStorage,
} from "../lib/retro-session-client";
import {
  createBrowserRetroNavigation,
  parseRetroRoomCode,
} from "../lib/retro-route";
import { RetroHistorySession } from "../lib/retro-history-session";
import {
  isRetroHistoryPolicyKey,
  RETRO_HISTORY_POLICY_CHANGED,
} from "../lib/retro-history";
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
  const history = useMemo(() => new RetroHistorySession(), []);
  const historyState = useSyncExternalStore(
    history.subscribe,
    history.getSnapshot,
    history.getSnapshot
  );
  const client = useMemo(
    () =>
      new RetroSessionClient({
        transport,
        initialCode: routeCode,
        sessions: browserSessions,
        history,
        clock: browserClock,
        timers: browserTimers,
        navigation: createBrowserRetroNavigation(),
      }),
    [routeCode, transport, history]
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (isRetroHistoryPolicyKey(event.key)) history.sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(RETRO_HISTORY_POLICY_CHANGED, history.sync);
    window.addEventListener("pagehide", history.flush);
    window.addEventListener("beforeunload", history.flush);
    return () => {
      window.removeEventListener("pagehide", history.flush);
      window.removeEventListener("beforeunload", history.flush);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RETRO_HISTORY_POLICY_CHANGED, history.sync);
      history.dispose();
    };
  }, [history]);

  useEffect(() => {
    client.start();
    const updateEnvironment = () =>
      client.setEnvironment(
        navigator.onLine,
        document.visibilityState !== "hidden"
      );
    updateEnvironment();
    window.addEventListener("online", updateEnvironment);
    window.addEventListener("offline", updateEnvironment);
    document.addEventListener("visibilitychange", updateEnvironment);
    return () => {
      window.removeEventListener("online", updateEnvironment);
      window.removeEventListener("offline", updateEnvironment);
      document.removeEventListener("visibilitychange", updateEnvironment);
      client.dispose();
    };
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
    reconnectAttempt: state.reconnectAttempt,
    recovery: state.recovery,
    terminal: state.phase === "terminal",
    pending: state.pendingRequestId !== null,
    error: state.error,
    send: client.send,
    sendPresence: client.sendPresence,
    presence: state.presence,
    retry: client.retry,
    cookieSaved: state.cookieSaved,
    historySaved: historyState.saved,
    historyPreference: historyState.preference,
    historyPreferenceSaved: historyState.preferenceSaved,
    historyDisabled: historyState.disabled,
    chooseHistoryPreference: history.choose,
    rememberedIdentity: state.rememberedIdentity,
    rememberedStatus: state.rememberedStatus,
    inspectRemembered: client.inspectRemembered,
    continueRememberedSession: client.continueRememberedSession,
    forgetRememberedSession: client.forgetRememberedSession,
  };
}

export type RetroSession = ReturnType<typeof useRetroSocket>;
