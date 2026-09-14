import { z } from "zod";
import type { RetroRoom } from "shared/retrospective";

export const RETRO_HISTORY_PREFIX = "retro-history-v1:";
export const RETRO_HISTORY_CHANGED = "retro-history-changed";

// Parse both server snapshots and local data with an allowlist. Private session
// fields (including future additions) must never enter the archive or exports.
const roomSchema = z.object({
  code: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().max(100),
  phase: z.enum(["write", "vote", "discuss", "closed"]),
  expiresAt: z.number().int().nonnegative().max(8.64e15),
  members: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(30),
        moderator: z.boolean(),
        connected: z.boolean(),
      })
    )
    .max(30),
  notes: z
    .array(
      z.object({
        id: z.string(),
        authorId: z.string(),
        column: z.enum(["went-well", "improve", "ideas"]),
        text: z.string().max(1000),
        voterIds: z.array(z.string()).max(30),
      })
    )
    .max(300),
  actions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(1000),
        owner: z.string().max(60),
        done: z.boolean(),
      })
    )
    .max(100),
});
const archiveSchema = z.object({
  version: z.literal(1),
  savedAt: z.number().int().nonnegative().max(8.64e15),
  viewerId: z.string().optional(),
  room: roomSchema,
});
export type SavedRetro = z.infer<typeof archiveSchema>;

export function publicRetro(
  room: RetroRoom,
  viewerId?: string | null
): RetroRoom {
  const snapshot = roomSchema.parse(room);
  if (snapshot.phase !== "write") return snapshot;
  return {
    ...snapshot,
    // Fail closed when sanitizing a write-phase snapshot without its audience.
    notes: viewerId
      ? snapshot.notes.filter((note) => note.authorId === viewerId)
      : [],
  };
}

export function retroHistoryKey(room: RetroRoom): string {
  // Codes can be reused after expiry; keep those retros separate.
  return `${RETRO_HISTORY_PREFIX}${room.code}:${room.expiresAt}`;
}

export function saveRetroHistory(
  room: RetroRoom,
  viewerId?: string | null
): boolean {
  try {
    const snapshot = publicRetro(room, viewerId);
    const key = retroHistoryKey(snapshot);
    const previous = localStorage.getItem(key);
    if (previous) {
      try {
        const parsed = archiveSchema.safeParse(JSON.parse(previous));
        if (
          parsed.success &&
          parsed.data.room.phase === "closed" &&
          snapshot.phase !== "closed"
        )
          return true;
      } catch {
        /* Replace a corrupt entry with the fresh snapshot. */
      }
    }
    const entry: SavedRetro = {
      version: 1,
      savedAt: Date.now(),
      ...(viewerId ? { viewerId } : {}),
      room: snapshot,
    };
    localStorage.setItem(key, JSON.stringify(entry));
    window.dispatchEvent(new Event(RETRO_HISTORY_CHANGED));
    return true;
  } catch {
    return false;
  }
}

export function readRetroHistory(): {
  entries: SavedRetro[];
  error: string | null;
} {
  const entries: SavedRetro[] = [];
  let error: string | null = null;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(RETRO_HISTORY_PREFIX)) continue;
      try {
        const parsed = archiveSchema.parse(
          JSON.parse(localStorage.getItem(key) ?? "null")
        );
        const entry = {
          ...parsed,
          room: publicRetro(parsed.room, parsed.viewerId),
        };
        if (key !== retroHistoryKey(entry.room)) throw new Error("Invalid key");
        if (
          parsed.room.phase === "write" &&
          !parsed.viewerId &&
          parsed.room.notes.length
        ) {
          // Pre-private-writing archives have no audience marker. Remove their
          // notes in storage as well as in the rendered/exported snapshot.
          localStorage.setItem(key, JSON.stringify(entry));
        }
        entries.push(entry);
      } catch {
        error =
          "Some saved retrospectives could not be read. Other saved retros are still available.";
      }
    }
  } catch {
    error =
      "Browser history storage is unavailable. Enable local storage to save retrospectives.";
  }
  return { entries: entries.sort((a, b) => b.savedAt - a.savedAt), error };
}

export function deleteRetroHistory(room: RetroRoom): boolean {
  try {
    localStorage.removeItem(retroHistoryKey(room));
    window.dispatchEvent(new Event(RETRO_HISTORY_CHANGED));
    return true;
  } catch {
    return false;
  }
}
