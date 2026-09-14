import { z } from "zod";
import type { RetroRoom } from "shared/retrospective";

export const RETRO_HISTORY_PREFIX = "retro-history-v1:";
export const RETRO_HISTORY_CHANGED = "retro-history-changed";

// Parse both server snapshots and local data with an allowlist. Private session
// fields (including future additions) must never enter the archive or exports.
const noteFields = {
  id: z.string(),
  authorId: z.string(),
  column: z.enum(["went-well", "improve", "ideas"]),
  text: z.string().max(1000),
};
const roomBaseSchema = z.object({
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
        // Version 2 archives created before phase readiness omit this field.
        ready: z.boolean().default(false),
      })
    )
    .max(30),
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
const roomSchema = roomBaseSchema.extend({
  notes: z
    .array(
      z.object({
        ...noteFields,
        voteCount: z.number().int().min(0).max(30).nullable(),
        votedBySelf: z.boolean(),
      })
    )
    .max(300),
});
const legacyRoomSchema = roomBaseSchema.extend({
  notes: z
    .array(
      z.object({
        ...noteFields,
        voterIds: z.array(z.string()).max(30),
      })
    )
    .max(300),
});
const archiveSchema = z.object({
  version: z.literal(2),
  savedAt: z.number().int().nonnegative().max(8.64e15),
  viewerId: z.string().optional(),
  room: roomSchema,
});
const legacyArchiveSchema = z.object({
  version: z.literal(1),
  savedAt: z.number().int().nonnegative().max(8.64e15),
  viewerId: z.string().optional(),
  room: legacyRoomSchema,
});
export type SavedRetro = z.infer<typeof archiveSchema>;

function parseArchive(value: unknown): {
  entry: SavedRetro;
  migrated: boolean;
} {
  const current = archiveSchema.safeParse(value);
  if (current.success) return { entry: current.data, migrated: false };
  const legacy = legacyArchiveSchema.parse(value);
  const room = roomSchema.parse({
    ...legacy.room,
    notes: legacy.room.notes.map(({ voterIds, ...note }) => ({
      ...note,
      voteCount:
        legacy.room.phase === "discuss" || legacy.room.phase === "closed"
          ? voterIds.length
          : null,
      votedBySelf:
        legacy.room.phase === "vote" &&
        !!legacy.viewerId &&
        voterIds.includes(legacy.viewerId),
    })),
  });
  return {
    entry: {
      version: 2,
      savedAt: legacy.savedAt,
      ...(legacy.viewerId ? { viewerId: legacy.viewerId } : {}),
      room,
    },
    migrated: true,
  };
}

export function publicRetro(
  room: RetroRoom,
  viewerId?: string | null
): RetroRoom {
  const snapshot = roomSchema.parse(room);
  return {
    ...snapshot,
    notes: snapshot.notes
      // Fail closed when sanitizing a write-phase snapshot without its audience.
      .filter(
        (note) =>
          snapshot.phase !== "write" ||
          (!!viewerId && note.authorId === viewerId)
      )
      .map((note) => ({
        ...note,
        voteCount:
          snapshot.phase === "discuss" || snapshot.phase === "closed"
            ? (note.voteCount ?? 0)
            : null,
        votedBySelf: snapshot.phase === "vote" && note.votedBySelf,
      })),
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
        const parsed = parseArchive(JSON.parse(previous));
        if (
          parsed.entry.room.phase === "closed" &&
          snapshot.phase !== "closed"
        ) {
          if (parsed.migrated) {
            try {
              localStorage.setItem(
                key,
                JSON.stringify({
                  ...parsed.entry,
                  room: publicRetro(parsed.entry.room, parsed.entry.viewerId),
                })
              );
            } catch {
              /* Preserve the final entry even when it cannot be rewritten. */
            }
          }
          return true;
        }
      } catch {
        /* Replace a corrupt entry with the fresh snapshot. */
      }
    }
    const entry: SavedRetro = {
      version: 2,
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
        const parsed = parseArchive(
          JSON.parse(localStorage.getItem(key) ?? "null")
        );
        const entry: SavedRetro = {
          ...parsed.entry,
          room: publicRetro(parsed.entry.room, parsed.entry.viewerId),
        };
        if (key !== retroHistoryKey(entry.room)) throw new Error("Invalid key");
        if (
          parsed.migrated ||
          JSON.stringify(parsed.entry) !== JSON.stringify(entry)
        ) {
          // Rewrite legacy entries without voter identities. Failure to rewrite
          // must not hide an otherwise readable local snapshot.
          try {
            localStorage.setItem(key, JSON.stringify(entry));
          } catch {
            /* Storage may be read-only or full. */
          }
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
