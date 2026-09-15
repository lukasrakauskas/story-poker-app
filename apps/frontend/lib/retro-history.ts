import {
  migrateRetroArchive,
  retroArchiveSchema,
  retroPublicRoomSchema,
  RETRO_ARCHIVE_VERSION,
  RETRO_HISTORY_KEY_VERSION,
  type RetroArchive,
  type RetroRoom,
} from "shared/retrospective";

export const RETRO_HISTORY_PREFIX = `retro-history-v${RETRO_HISTORY_KEY_VERSION}:`;
export const RETRO_HISTORY_CHANGED = "retro-history-changed";
export type SavedRetro = RetroArchive;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function pick(value: unknown, fields: readonly string[]): unknown {
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

function projectActionOwner(value: unknown): unknown {
  const source = record(value);
  if (!source) return value;
  if (source.kind === "unassigned") return { kind: "unassigned" };
  if (source.kind === "participant")
    return pick(source, ["kind", "participantId", "name"]);
  if (source.kind === "external") return pick(source, ["kind", "name"]);
  return value;
}

/**
 * Archive/export sanitization is an allowlist projection, not network parsing.
 * It deliberately drops credentials and future private fields before the
 * strict public schema is applied. The socket uses the strict schema directly.
 */
function projectPublicRoom(value: unknown): unknown {
  const source = record(value);
  if (!source) return value;
  return {
    code: source.code,
    title: source.title,
    phase: source.phase,
    expiresAt: source.expiresAt,
    closedAt: source.closedAt,
    requiresPassword: source.requiresPassword,
    members: Array.isArray(source.members)
      ? source.members.map((member) =>
          pick(member, ["id", "name", "moderator", "connected", "ready"])
        )
      : source.members,
    notes: Array.isArray(source.notes)
      ? source.notes.map((note) =>
          pick(note, [
            "id",
            "authorId",
            "authorName",
            "column",
            "text",
            "groupId",
            "voteCount",
            "votedBySelf",
          ])
        )
      : source.notes,
    groups: Array.isArray(source.groups)
      ? source.groups.map((group) =>
          pick(group, ["id", "title", "voteCount", "votedBySelf"])
        )
      : source.groups,
    actions: Array.isArray(source.actions)
      ? source.actions.map((action) => {
          const projected = record(action);
          if (!projected) return action;
          return {
            ...(record(pick(projected, ["id", "text", "done"])) ?? {}),
            owner: projectActionOwner(projected.owner),
          };
        })
      : source.actions,
  };
}

/** Validate a public room after explicitly removing private/future fields. */
export function sanitizePublicRetroRoom(value: unknown): RetroRoom {
  return retroPublicRoomSchema.parse(projectPublicRoom(value));
}

function parseArchive(value: unknown): {
  entry: SavedRetro;
  migrated: boolean;
} {
  // The shared migrator owns the versioned v1/v2/v3 shapes and never returns
  // voterIds. Public projection below still runs for defense in depth.
  return migrateRetroArchive(value);
}

export function publicRetro(
  room: RetroRoom,
  viewerId?: string | null
): RetroRoom {
  const snapshot = sanitizePublicRetroRoom(room);
  return retroPublicRoomSchema.parse({
    ...snapshot,
    groups: snapshot.groups.map((group) => ({
      ...group,
      voteCount:
        snapshot.phase === "discuss" || snapshot.phase === "closed"
          ? (group.voteCount ?? 0)
          : null,
      votedBySelf: snapshot.phase === "vote" && group.votedBySelf,
    })),
    notes: snapshot.notes
      // Fail closed when sanitizing a write-phase snapshot without its audience.
      .filter(
        (note) =>
          snapshot.phase !== "write" ||
          (!!viewerId && note.authorId === viewerId)
      )
      .map((note) => ({
        ...note,
        authorName:
          note.authorName === "Former member"
            ? (snapshot.members.find((member) => member.id === note.authorId)
                ?.name ?? note.authorName)
            : note.authorName,
        voteCount:
          !note.groupId &&
          (snapshot.phase === "discuss" || snapshot.phase === "closed")
            ? (note.voteCount ?? 0)
            : null,
        votedBySelf: snapshot.phase === "vote" && note.votedBySelf,
      })),
  });
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
        if (parsed.entry.room.phase === "closed") {
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
    const entry: SavedRetro = retroArchiveSchema.parse({
      version: RETRO_ARCHIVE_VERSION,
      savedAt: Date.now(),
      ...(viewerId ? { viewerId } : {}),
      room: snapshot,
    });
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
        const entry: SavedRetro = retroArchiveSchema.parse({
          ...parsed.entry,
          room: publicRetro(parsed.entry.room, parsed.entry.viewerId),
        });
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
