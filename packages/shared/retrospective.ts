export type RetroColumn = "went-well" | "improve" | "ideas";
export type RetroPhase = "write" | "group" | "vote" | "discuss" | "closed";
export interface RetroMember {
  id: string;
  name: string;
  moderator: boolean;
  connected: boolean;
  /** Readiness for the current write/vote phase; reset when the phase changes. */
  ready: boolean;
}
export interface RetroNote {
  id: string;
  authorId: string;
  /** Stable display snapshot retained if the participant is removed. */
  authorName: string;
  column: RetroColumn;
  text: string;
  groupId: string | null;
  /** Hidden until discussion starts so open voting stays blind. */
  voteCount: number | null;
  /** Recipient-specific selection state; never identifies another voter. */
  votedBySelf: boolean;
}
export interface RetroGroup {
  id: string;
  title: string;
  /** Hidden until discussion starts so open voting stays blind. */
  voteCount: number | null;
  /** Recipient-specific selection state; never identifies another voter. */
  votedBySelf: boolean;
}
export type RetroActionOwner =
  | { kind: "unassigned" }
  | { kind: "participant"; participantId: string; name: string }
  | { kind: "external"; name: string };
export type RetroActionAssignment =
  | { kind: "unassigned" }
  | { kind: "participant"; participantId: string }
  | { kind: "external"; name: string };

export function actionOwnerLabel(owner: RetroActionOwner): string {
  return owner.kind === "unassigned" ? "Unassigned" : owner.name;
}

export interface RetroAction {
  id: string;
  text: string;
  /** Participant names are server-authored snapshots, retained after removal. */
  owner: RetroActionOwner;
  done: boolean;
}
export interface RetroRoom {
  code: string;
  title: string;
  phase: RetroPhase;
  expiresAt: number;
  members: RetroMember[];
  notes: RetroNote[];
  groups: RetroGroup[];
  actions: RetroAction[];
}
export type RetroCommand =
  | { type: "create"; name: string; title: string }
  | { type: "join"; name: string; code: string }
  | { type: "resume"; code: string; token: string }
  | { type: "add-note"; column: RetroColumn; text: string }
  | { type: "edit-note"; id: string; text: string }
  | { type: "delete-note"; id: string }
  | { type: "group-notes"; title: string; noteIds: string[] }
  | { type: "ungroup-note"; id: string }
  | { type: "move-note"; id: string; groupId: string }
  | { type: "remove-member"; memberId: string }
  | { type: "toggle-vote"; id: string }
  | { type: "toggle-ready" }
  | { type: "transfer-moderator"; memberId: string }
  | { type: "claim-moderator" }
  | { type: "advance" }
  | { type: "add-action"; text: string; owner: RetroActionAssignment }
  | {
      type: "edit-action";
      id: string;
      text: string;
      owner: RetroActionAssignment;
    }
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
