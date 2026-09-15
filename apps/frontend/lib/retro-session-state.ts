import type { RetroRoom, RetroRoomInfo } from "shared/retrospective";

export type RetroConnection = "connecting" | "connected" | "disconnected";
export type RetroSessionPhase =
  | "anonymous"
  | "resuming"
  | "active"
  | "terminal";
export type RetroFailure = { code: string; message: string };

/**
 * State exposed by the retrospective client. `phase` is deliberately separate
 * from socket connectivity: an open socket can still be waiting for a resume,
 * and a replaced session must remain read-only after its socket closes.
 */
export interface RetroSessionState {
  connection: RetroConnection;
  phase: RetroSessionPhase;
  room: RetroRoom | null;
  roomInfo: RetroRoomInfo | null;
  selfId: string | null;
  pendingRequestId: string | null;
  error: RetroFailure | null;
  cookieSaved: boolean | null;
  historySaved: boolean | null;
}

export const initialRetroSessionState: RetroSessionState = {
  connection: "connecting",
  phase: "anonymous",
  room: null,
  roomInfo: null,
  selfId: null,
  pendingRequestId: null,
  error: null,
  cookieSaved: null,
  historySaved: null,
};

type RetroSessionAction =
  | { type: "start"; resuming: boolean }
  | { type: "open"; resuming: boolean }
  | { type: "request-started"; requestId: string; resuming: boolean }
  | {
      type: "snapshot";
      room: RetroRoom;
      selfId: string;
      acknowledged: boolean;
    }
  | { type: "room-info"; info: RetroRoomInfo }
  | { type: "request-settled"; requestId: string; success: boolean }
  | { type: "server-error"; error: RetroFailure }
  | {
      type: "connection-failed";
      error: RetroFailure;
      terminal?: boolean;
      clearSelf?: boolean;
    }
  | { type: "retry"; resuming: boolean };

export function retroSessionReducer(
  state: RetroSessionState,
  action: RetroSessionAction
): RetroSessionState {
  switch (action.type) {
    case "start":
    case "retry":
      if (state.phase === "terminal") return state;
      return {
        ...state,
        connection: "connecting",
        phase: action.resuming ? "resuming" : state.phase,
        error: null,
      };
    case "open":
      if (state.phase === "terminal") return state;
      return {
        ...state,
        connection: "connected",
        phase: action.resuming
          ? "resuming"
          : state.room
            ? "active"
            : "anonymous",
        error: null,
      };
    case "request-started":
      if (state.phase === "terminal") return state;
      return {
        ...state,
        connection: "connected",
        phase: action.resuming
          ? "resuming"
          : state.room
            ? "active"
            : "anonymous",
        pendingRequestId: action.requestId,
        error: null,
      };
    case "snapshot":
      if (state.phase === "terminal") return state;
      return {
        ...state,
        connection: "connected",
        phase:
          action.acknowledged || state.phase !== "resuming"
            ? "active"
            : "resuming",
        room: action.room,
        roomInfo: null,
        selfId: action.selfId,
        error: action.acknowledged ? null : state.error,
      };
    case "room-info":
      return { ...state, roomInfo: action.info, error: null };
    case "request-settled":
      if (state.pendingRequestId !== action.requestId) return state;
      return {
        ...state,
        pendingRequestId: null,
        error: action.success ? null : state.error,
      };
    case "server-error":
      return { ...state, error: action.error };
    case "connection-failed":
      return {
        ...state,
        connection: "disconnected",
        phase: action.terminal ? "terminal" : state.phase,
        pendingRequestId: null,
        selfId: action.clearSelf ? null : state.selfId,
        error: action.error,
      };
  }
}

export type { RetroSessionAction };
