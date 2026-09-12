export type RetroColumn = "went-well" | "improve" | "ideas";
export type RetroPhase = "write" | "vote" | "discuss" | "closed";
export interface RetroMember {
  id: string;
  name: string;
  moderator: boolean;
  connected: boolean;
}
export interface RetroNote {
  id: string;
  authorId: string;
  column: RetroColumn;
  text: string;
  voterIds: string[];
}
export interface RetroAction {
  id: string;
  text: string;
  owner: string;
  done: boolean;
}
export interface RetroRoom {
  code: string;
  title: string;
  phase: RetroPhase;
  expiresAt: number;
  members: RetroMember[];
  notes: RetroNote[];
  actions: RetroAction[];
}
export type RetroCommand =
  | { type: "create"; name: string; title: string }
  | { type: "join"; name: string; code: string }
  | { type: "resume"; code: string; token: string }
  | { type: "add-note"; column: RetroColumn; text: string }
  | { type: "edit-note"; id: string; text: string }
  | { type: "delete-note"; id: string }
  | { type: "toggle-vote"; id: string }
  | { type: "advance" }
  | { type: "add-action"; text: string; owner: string }
  | { type: "toggle-action"; id: string }
  | { type: "delete-action"; id: string };
export type RetroServerEvent =
  | {
      event: "retro-state";
      data: {
        room: RetroRoom;
        self: { id: string; token: string };
        requestId?: string;
      };
    }
  | {
      event: "retro-error";
      data: { code: string; message: string; requestId?: string };
    };
