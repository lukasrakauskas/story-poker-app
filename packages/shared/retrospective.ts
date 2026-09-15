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
  /** Server completion time; null until closed (or in legacy archives). */
  closedAt: number | null;
  members: RetroMember[];
  /** Server creation order; retained through grouping, snapshots and archives. */
  notes: RetroNote[];
  groups: RetroGroup[];
  actions: RetroAction[];
}

/**
 * Recipient-only data attached to a versioned full state. The public room is
 * deliberately useful without this envelope: writing notes are omitted and
 * open-vote selections are represented only by target IDs.
 */
export interface RetroRecipientEnvelope {
  notes: RetroNote[];
  votedNoteIds: string[];
  votedGroupIds: string[];
}

/**
 * Every state update is authoritative for its version. Keeping privacy-only
 * fields separate lets the server reuse the public projection and its encoded
 * form for every recipient without sharing tokens or blind selections.
 */
export interface RetroStateData {
  room: RetroRoom;
  self: { id: string; token: string };
  recipient: RetroRecipientEnvelope;
  /** Monotonically increasing committed room version. */
  version: number;
  requestId?: string;
}

export function materializeRetroState(data: RetroStateData): RetroRoom {
  const voteNotes = new Set(data.recipient.votedNoteIds);
  const voteGroups = new Set(data.recipient.votedGroupIds);
  return {
    ...data.room,
    notes:
      data.room.phase === "write"
        ? data.recipient.notes.map((note) => ({ ...note }))
        : data.room.notes.map((note) => ({
            ...note,
            votedBySelf:
              data.room.phase === "vote" &&
              !note.groupId &&
              voteNotes.has(note.id),
          })),
    groups: data.room.groups.map((group) => ({
      ...group,
      votedBySelf: data.room.phase === "vote" && voteGroups.has(group.id),
    })),
  };
}

export type RetroVersionStatus = "next" | "stale" | "gap";

export function retroVersionStatus(
  lastVersion: number | null,
  incomingVersion: number,
  authoritative = false
): RetroVersionStatus {
  if (
    authoritative ||
    lastVersion === null ||
    incomingVersion === lastVersion + 1
  )
    return "next";
  return incomingVersion <= lastVersion ? "stale" : "gap";
}

export type RetroCommand =
  | { type: "create"; name: string; title: string }
  | { type: "join"; name: string; code: string }
  | { type: "resume"; code: string; token: string }
  /** Request one authoritative full state after a version gap. */
  | { type: "refresh" }
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
      data: RetroStateData;
    }
  | {
      event: "retro-error";
      data: { code: string; message: string; requestId?: string };
    };
