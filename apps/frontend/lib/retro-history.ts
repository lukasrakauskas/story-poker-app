import { z } from "zod";
import type { RetroRoom } from "shared/retrospective";

export const RETRO_HISTORY_PREFIX = "retro-history-v1:";
export const RETRO_HISTORY_CHANGED = "retro-history-changed";
export const RETRO_HISTORY_POLICY_CHANGED = "retro-history-policy-changed";
export const RETRO_HISTORY_PREFERENCE_PREFIX = "retro-history-preference-v1:";
export const RETRO_HISTORY_DISABLED_PREFIX = "retro-history-disabled-v1:";
export const RETRO_HISTORY_DELETE_ALL_KEY = "retro-history-delete-all-v1";

export const RETRO_HISTORY_RETENTION_MS = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  forever: null,
} as const;

export type RetroHistoryRetention = keyof typeof RETRO_HISTORY_RETENTION_MS;
export type RetroHistoryMode = "final-only" | "recovery" | "none";
export type RetroHistoryPolicy = {
  mode: RetroHistoryMode;
  retention?: RetroHistoryRetention;
};
export type RetroHistoryPreference = {
  mode: RetroHistoryMode;
  retention: RetroHistoryRetention;
};

export const DEFAULT_RETRO_HISTORY_RETENTION: RetroHistoryRetention = "30d";
export const DEFAULT_RETRO_HISTORY_POLICY = {
  mode: "final-only",
  retention: DEFAULT_RETRO_HISTORY_RETENTION,
} as const;

// These small browser-facing interfaces are deliberately structural. A future
// session/transport layer can inject IndexedDB, an in-memory adapter, or a
// worker without making this module read browser globals directly.
export interface RetroHistoryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RetroHistoryEventTarget {
  dispatchEvent(event: Event): boolean;
}

export interface RetroHistoryScheduler {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RetroHistoryDependencies {
  storage?: RetroHistoryStorage | (() => RetroHistoryStorage | null) | null;
  eventTarget?:
    | RetroHistoryEventTarget
    | (() => RetroHistoryEventTarget | null)
    | null;
  clock?: () => number;
  scheduler?: RetroHistoryScheduler;
}

// Parse both server snapshots and local data with an allowlist. Private session
// fields (including future additions) must never enter the archive or exports.
const noteFields = {
  id: z.string(),
  authorId: z.string(),
  // Older archives derive this stable display snapshot from their member list.
  authorName: z.string().max(30).default("Former member"),
  column: z.enum(["went-well", "improve", "ideas"]),
  text: z.string().max(1000),
  groupId: z.string().nullable().default(null),
};
const groupSchema = z.object({
  id: z.string(),
  title: z.string().max(100),
  voteCount: z.number().int().min(0).max(30).nullable(),
  votedBySelf: z.boolean(),
});
const actionOwnerSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unassigned") }),
    z.object({
      kind: z.literal("participant"),
      participantId: z.string(),
      name: z.string().max(30),
    }),
    z.object({ kind: z.literal("external"), name: z.string().max(60) }),
  ]),
  // Legacy free-text owners must not be guessed into participant identities.
  z
    .string()
    .max(60)
    .transform((name) =>
      name.trim()
        ? { kind: "external" as const, name: name.trim() }
        : { kind: "unassigned" as const }
    ),
]);
const roomBaseSchema = z.object({
  code: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().max(100),
  phase: z.enum(["write", "group", "vote", "discuss", "closed"]),
  expiresAt: z.number().int().nonnegative().max(8.64e15),
  closedAt: z
    .number()
    .int()
    .nonnegative()
    .max(8.64e15)
    .nullable()
    .default(null),
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
  groups: z.array(groupSchema).max(300).default([]),
  actions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(1000),
        owner: actionOwnerSchema,
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
  version: z.literal(3),
  savedAt: z.number().int().nonnegative().max(8.64e15),
  // The deadline is part of the archive so cleanup remains deterministic even
  // when a different preference is selected for a later room lifetime.
  retentionUntil: z
    .number()
    .int()
    .nonnegative()
    .max(8.64e15)
    .nullable()
    .optional(),
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

const preferenceSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["final-only", "recovery", "none"]),
  retention: z.enum(["7d", "30d", "90d", "forever"]),
  chosenAt: z.number().int().nonnegative().max(8.64e15),
});
const deleteAllSchema = z.object({
  version: z.literal(1),
  deletedAt: z.number().int().nonnegative().max(8.64e15),
  // Explicitly re-choosing a room after Delete all adds only that room to this
  // allowlist. Existing live rooms remain suppressed in every other tab.
  allowed: z.array(z.string()).max(10000),
});

function parseArchive(value: unknown): {
  entry: SavedRetro;
  migrated: boolean;
} {
  const current = archiveSchema.safeParse(value);
  if (current.success) return { entry: current.data, migrated: false };
  const versionTwo = archiveSchema
    .extend({ version: z.literal(2) })
    .safeParse(value);
  if (versionTwo.success)
    return { entry: { ...versionTwo.data, version: 3 }, migrated: true };
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
      version: 3,
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
  };
}

export function retroHistoryKey(
  room: Pick<RetroRoom, "code" | "expiresAt">
): string {
  // Codes can be reused after expiry; keep those retros separate.
  return `${RETRO_HISTORY_PREFIX}${room.code}:${room.expiresAt}`;
}

export function retroHistoryPreferenceKey(
  room: Pick<RetroRoom, "code" | "expiresAt">
): string {
  return `${RETRO_HISTORY_PREFERENCE_PREFIX}${room.code}:${room.expiresAt}`;
}

export function retroHistoryDisabledKey(
  room: Pick<RetroRoom, "code" | "expiresAt">
): string {
  return `${RETRO_HISTORY_DISABLED_PREFIX}${room.code}:${room.expiresAt}`;
}

export function isRetroHistoryPolicyKey(key: string | null): boolean {
  return (
    key === null ||
    key === RETRO_HISTORY_DELETE_ALL_KEY ||
    key.startsWith(RETRO_HISTORY_PREFERENCE_PREFIX) ||
    key.startsWith(RETRO_HISTORY_DISABLED_PREFIX)
  );
}

function browserStorage(): RetroHistoryStorage | null {
  try {
    // Use the global property rather than window.localStorage so non-browser
    // adapters can provide a window-shaped event target in unit tests.
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function browserEvents(): RetroHistoryEventTarget | null {
  try {
    return typeof window === "undefined" ? null : window;
  } catch {
    return null;
  }
}

const MAX_SCHEDULER_DELAY = 2_147_483_647;

const browserScheduler: RetroHistoryScheduler = {
  setTimeout(callback, delay) {
    const handle = globalThis.setTimeout(callback, delay);
    // Do not keep a server-side unit-test process alive for a browser retention
    // timer. Browsers do not expose unref, so this is a harmless no-op there.
    const unref = (handle as { unref?: () => void }).unref;
    unref?.call(handle);
    return handle;
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function normalizedPolicy(
  policy: RetroHistoryPolicy | undefined
): RetroHistoryPreference | null {
  if (!policy) return null;
  const candidate = {
    mode: policy.mode,
    retention: policy.retention ?? DEFAULT_RETRO_HISTORY_RETENTION,
  };
  const parsed = preferenceSchema
    .omit({ version: true, chosenAt: true })
    .safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function retentionDeadline(
  now: number,
  retention: RetroHistoryRetention
): number | null {
  const duration = RETRO_HISTORY_RETENTION_MS[retention];
  return duration === null
    ? null
    : Math.min(8.64e15, Math.max(0, now + duration));
}

function parsePreference(value: string | null): RetroHistoryPreference | null {
  if (!value) return null;
  const parsed = preferenceSchema.safeParse(JSON.parse(value));
  return parsed.success
    ? { mode: parsed.data.mode, retention: parsed.data.retention }
    : null;
}

function parseDeleteAll(value: string | null) {
  if (!value) return null;
  const parsed = deleteAllSchema.safeParse(JSON.parse(value));
  return parsed.success ? parsed.data : null;
}

function notify(target: RetroHistoryEventTarget | null, name: string): void {
  try {
    if (target && typeof Event !== "undefined")
      target.dispatchEvent(new Event(name));
  } catch {
    // Notifications are advisory. A blocked event target must not affect the
    // collaboration or the result of a successful storage operation.
  }
}

export interface RetroHistoryPersistence {
  saveRetroHistory(
    room: RetroRoom,
    viewerId: string | null | undefined,
    policy?: RetroHistoryPolicy
  ): boolean;
  readRetroHistory(): { entries: SavedRetro[]; error: string | null };
  deleteRetroHistory(room: RetroRoom): boolean;
  deleteAllRetroHistory(): boolean;
  readRetroHistoryPreference(
    room: Pick<RetroRoom, "code" | "expiresAt">
  ): RetroHistoryPreference | null;
  saveRetroHistoryPreference(
    room: Pick<RetroRoom, "code" | "expiresAt">,
    policy: RetroHistoryPolicy
  ): boolean;
  isRetroHistorySuppressed(
    room: Pick<RetroRoom, "code" | "expiresAt">
  ): boolean;
  // The scheduler is intentionally exposed for future coalesced persistence and
  // retention work. The default page performs cleanup when it reads history.
  scheduleCleanup(delayMs?: number): void;
  dispose(): void;

  // Short aliases make the adapter convenient to pass to a session client.
  save: RetroHistoryPersistence["saveRetroHistory"];
  read: RetroHistoryPersistence["readRetroHistory"];
}

export function createRetroHistoryPersistence(
  dependencies: RetroHistoryDependencies = {}
): RetroHistoryPersistence {
  const clock = dependencies.clock ?? (() => Date.now());
  const scheduler = dependencies.scheduler ?? browserScheduler;
  let cleanupTimer: unknown = null;

  function storage(): RetroHistoryStorage | null {
    try {
      const source = dependencies.storage;
      if (typeof source === "function") return source();
      if (source !== undefined) return source;
      return browserStorage();
    } catch {
      return null;
    }
  }

  function events(): RetroHistoryEventTarget | null {
    try {
      const source = dependencies.eventTarget;
      if (typeof source === "function") return source();
      if (source !== undefined) return source;
      return browserEvents();
    } catch {
      return null;
    }
  }

  function readStoredPreference(
    source: RetroHistoryStorage,
    room: Pick<RetroRoom, "code" | "expiresAt">
  ): RetroHistoryPreference | null {
    try {
      return parsePreference(source.getItem(retroHistoryPreferenceKey(room)));
    } catch {
      return null;
    }
  }

  function suppressed(
    room: Pick<RetroRoom, "code" | "expiresAt">,
    source: RetroHistoryStorage | null = storage()
  ): boolean {
    // A missing storage backend is not a policy decision. The save path still
    // fails closed, while the UI can accept an in-memory choice and keep the
    // room usable.
    if (!source) return false;
    try {
      if (source.getItem(retroHistoryDisabledKey(room)) !== null) return true;
      if (readStoredPreference(source, room)?.mode === "none") return true;
      const raw = source.getItem(RETRO_HISTORY_DELETE_ALL_KEY);
      if (!raw) return false;
      const deletion = parseDeleteAll(raw);
      // A malformed suppression marker fails closed. An explicit preference can
      // repair it by writing a fresh allowlist for the selected room.
      return !deletion || !deletion.allowed.includes(retroHistoryKey(room));
    } catch {
      // Save operations still fail closed when this read cannot complete; do
      // not turn a transient browser storage error into a blocking room UI.
      return false;
    }
  }

  function saveHistory(
    room: RetroRoom,
    viewerId: string | null | undefined,
    policy?: RetroHistoryPolicy
  ): boolean {
    const normalized = normalizedPolicy(policy);
    // An omitted policy is deliberately a no-op. This is the guard that keeps
    // old callers from silently returning to unconditional history writes.
    if (
      !normalized ||
      normalized.mode === "none" ||
      (normalized.mode === "final-only" && room.phase !== "closed")
    )
      return false;

    const source = storage();
    if (!source || suppressed(room, source)) return false;
    const storedPreference = readStoredPreference(source, room);
    // A tab may still hold an older policy when another tab changes the
    // choice. Do not let that stale tab continue writing under the old rules.
    if (
      storedPreference &&
      (storedPreference.mode !== normalized.mode ||
        storedPreference.retention !== normalized.retention)
    )
      return false;
    try {
      const snapshot = publicRetro(room, viewerId);
      const key = retroHistoryKey(snapshot);
      const now = clock();
      const previousRaw = source.getItem(key);
      let previous: SavedRetro | null = null;
      if (previousRaw) {
        try {
          previous = parseArchive(JSON.parse(previousRaw)).entry;
          const previousExpired =
            previous.retentionUntil !== undefined &&
            previous.retentionUntil !== null &&
            previous.retentionUntil <= now;
          if (previous.room.phase === "closed" && !previousExpired) {
            // A closed outcome is immutable. Only scrub an old representation;
            // never replace its closedAt, actions, or saved time.
            try {
              const parsed = parseArchive(JSON.parse(previousRaw));
              if (parsed.migrated) {
                source.setItem(
                  key,
                  JSON.stringify({
                    ...parsed.entry,
                    room: publicRetro(parsed.entry.room, parsed.entry.viewerId),
                  })
                );
              }
            } catch {
              /* Preserve the final entry even when it cannot be rewritten. */
            }
            return true;
          }
        } catch {
          // Replace a corrupt entry with the fresh, allowlisted snapshot.
          previous = null;
        }
      }

      const entry: SavedRetro = {
        version: 3,
        savedAt:
          previous?.room.phase !== "closed" && snapshot.phase === "closed"
            ? (previous?.savedAt ?? now)
            : now,
        retentionUntil:
          previous?.retentionUntil !== undefined &&
          previous.retentionUntil !== null
            ? previous.retentionUntil
            : retentionDeadline(now, normalized.retention),
        ...(viewerId ? { viewerId } : {}),
        room: snapshot,
      };
      source.setItem(key, JSON.stringify(entry));
      // Re-check after the write to close the common cross-tab race where a
      // delete marker was written while this tab was serializing the snapshot.
      if (suppressed(room, source)) {
        try {
          source.removeItem(key);
        } catch {
          /* A failed cleanup is still safer than reporting a successful save. */
        }
        return false;
      }
      notify(events(), RETRO_HISTORY_CHANGED);
      if (entry.retentionUntil !== null && entry.retentionUntil !== undefined)
        scheduleCleanup(Math.max(0, entry.retentionUntil - now));
      return true;
    } catch {
      return false;
    }
  }

  function readHistory(): { entries: SavedRetro[]; error: string | null } {
    const entries: SavedRetro[] = [];
    let error: string | null = null;
    const source = storage();
    if (!source)
      return {
        entries,
        error:
          "Browser history storage is unavailable. Enable local storage to save retrospectives.",
      };
    try {
      let cleanupFailed = false;
      const now = clock();
      // Removing an expired key changes Storage.length and shifts indexes, so
      // take a stable key snapshot before doing any cleanup.
      const keys: string[] = [];
      for (let index = 0; index < source.length; index++) {
        const key = source.key(index);
        if (key?.startsWith(RETRO_HISTORY_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        try {
          const parsed = parseArchive(
            JSON.parse(source.getItem(key) ?? "null")
          );
          const entry: SavedRetro = {
            ...parsed.entry,
            room: publicRetro(parsed.entry.room, parsed.entry.viewerId),
          };
          if (key !== retroHistoryKey(entry.room))
            throw new Error("Invalid key");
          const expired =
            entry.retentionUntil !== undefined &&
            entry.retentionUntil !== null &&
            entry.retentionUntil <= now;
          if (expired) {
            try {
              source.removeItem(key);
            } catch {
              cleanupFailed = true;
              entries.push(entry);
            }
            continue;
          }
          if (
            parsed.migrated ||
            JSON.stringify(parsed.entry) !== JSON.stringify(entry)
          ) {
            // Rewrite legacy entries without voter identities. Failure to rewrite
            // must not hide an otherwise readable local snapshot.
            try {
              source.setItem(key, JSON.stringify(entry));
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
      if (cleanupFailed)
        error =
          "Some expired saved retrospectives could not be removed. Check browser storage permissions.";
    } catch {
      error =
        "Browser history storage is unavailable. Enable local storage to save retrospectives.";
    }
    return { entries: entries.sort((a, b) => b.savedAt - a.savedAt), error };
  }

  function savePreference(
    room: Pick<RetroRoom, "code" | "expiresAt">,
    policy: RetroHistoryPolicy
  ): boolean {
    const preference = normalizedPolicy(policy);
    const source = storage();
    if (!preference || !source) return false;
    let policyChanged = false;
    let historyChanged = false;
    try {
      const key = retroHistoryKey(room);
      const record = {
        version: 1 as const,
        ...preference,
        chosenAt: Math.max(0, Math.min(8.64e15, clock())),
      };
      if (preference.mode === "none") {
        // Suppress before deleting so an open tab cannot recreate the entry if
        // deletion or preference persistence is interrupted.
        source.setItem(
          retroHistoryDisabledKey(room),
          JSON.stringify({ version: 1, deletedAt: record.chosenAt })
        );
        policyChanged = true;
        source.setItem(retroHistoryPreferenceKey(room), JSON.stringify(record));
        source.removeItem(key);
        historyChanged = true;
      } else {
        // Write the choice before removing a per-room tombstone. If a later
        // storage operation fails, the conservative tombstone still wins.
        source.setItem(retroHistoryPreferenceKey(room), JSON.stringify(record));
        policyChanged = true;
        const rawDeleteAll = source.getItem(RETRO_HISTORY_DELETE_ALL_KEY);
        if (rawDeleteAll !== null) {
          const parsed = parseDeleteAll(rawDeleteAll);
          const allowed = parsed?.allowed ?? [];
          if (!allowed.includes(key)) {
            source.setItem(
              RETRO_HISTORY_DELETE_ALL_KEY,
              JSON.stringify({
                version: 1,
                deletedAt: parsed?.deletedAt ?? record.chosenAt,
                allowed: [...allowed, key],
              })
            );
          }
        }
        source.removeItem(retroHistoryDisabledKey(room));
        if (preference.mode === "final-only") {
          // A prior pre-choice/recovery snapshot is incompatible with the safe
          // final-only promise. Preserve an already closed outcome, but remove
          // any open archive before applying the new policy.
          let openArchive = false;
          try {
            const existing = source.getItem(key);
            if (existing)
              openArchive =
                parseArchive(JSON.parse(existing)).entry.room.phase !==
                "closed";
          } catch {
            openArchive = true;
          }
          if (openArchive) {
            source.removeItem(key);
            historyChanged = true;
          }
        }
      }
      notify(events(), RETRO_HISTORY_POLICY_CHANGED);
      if (historyChanged) notify(events(), RETRO_HISTORY_CHANGED);
      return true;
    } catch {
      // A partially written choice is safe: either its old tombstone or the new
      // preference prevents an unconsented write. Notify live tabs as well.
      if (policyChanged) notify(events(), RETRO_HISTORY_POLICY_CHANGED);
      return false;
    }
  }

  function readPreference(
    room: Pick<RetroRoom, "code" | "expiresAt">
  ): RetroHistoryPreference | null {
    const source = storage();
    return source ? readStoredPreference(source, room) : null;
  }

  function deleteHistory(room: RetroRoom): boolean {
    const source = storage();
    if (!source) return false;
    let policyChanged = false;
    try {
      const now = Math.max(0, Math.min(8.64e15, clock()));
      // A delete is also a durable per-room opt-out. This is intentionally
      // separate from the archive so a live tab cannot recreate it.
      source.setItem(
        retroHistoryDisabledKey(room),
        JSON.stringify({ version: 1, deletedAt: now })
      );
      policyChanged = true;
      source.removeItem(retroHistoryKey(room));
      source.removeItem(retroHistoryPreferenceKey(room));
      notify(events(), RETRO_HISTORY_POLICY_CHANGED);
      notify(events(), RETRO_HISTORY_CHANGED);
      return true;
    } catch {
      if (policyChanged) notify(events(), RETRO_HISTORY_POLICY_CHANGED);
      return false;
    }
  }

  function deleteAllHistory(): boolean {
    const source = storage();
    if (!source) return false;
    let policyChanged = false;
    try {
      const now = Math.max(0, Math.min(8.64e15, clock()));
      // The global tombstone is written first. It covers live rooms that have
      // never produced an archive (for example a final-only room still writing)
      // and is observed by other tabs through the browser storage event.
      source.setItem(
        RETRO_HISTORY_DELETE_ALL_KEY,
        JSON.stringify({ version: 1, deletedAt: now, allowed: [] })
      );
      policyChanged = true;
      const keys: string[] = [];
      for (let index = 0; index < source.length; index++) {
        const key = source.key(index);
        if (
          key &&
          (key.startsWith(RETRO_HISTORY_PREFIX) ||
            key.startsWith(RETRO_HISTORY_PREFERENCE_PREFIX) ||
            key.startsWith(RETRO_HISTORY_DISABLED_PREFIX))
        )
          keys.push(key);
      }
      for (const key of keys) source.removeItem(key);
      notify(events(), RETRO_HISTORY_POLICY_CHANGED);
      notify(events(), RETRO_HISTORY_CHANGED);
      return true;
    } catch {
      if (policyChanged) notify(events(), RETRO_HISTORY_POLICY_CHANGED);
      return false;
    }
  }

  function scheduleCleanup(delayMs = 0): void {
    const remaining = Math.max(0, delayMs);
    try {
      if (cleanupTimer !== null) scheduler.clearTimeout(cleanupTimer);
      cleanupTimer = scheduler.setTimeout(
        () => {
          cleanupTimer = null;
          readHistory();
          notify(events(), RETRO_HISTORY_CHANGED);
          // Browser timers cap delays at a signed 32-bit integer. Continue a
          // long retention countdown rather than accidentally firing at 1 ms.
          if (remaining > MAX_SCHEDULER_DELAY)
            scheduleCleanup(remaining - MAX_SCHEDULER_DELAY);
        },
        Math.min(MAX_SCHEDULER_DELAY, remaining)
      );
    } catch {
      cleanupTimer = null;
    }
  }

  function dispose(): void {
    if (cleanupTimer === null) return;
    try {
      scheduler.clearTimeout(cleanupTimer);
    } catch {
      /* A custom scheduler may already be disposed. */
    }
    cleanupTimer = null;
  }

  const persistence: RetroHistoryPersistence = {
    saveRetroHistory: saveHistory,
    readRetroHistory: readHistory,
    deleteRetroHistory: deleteHistory,
    deleteAllRetroHistory: deleteAllHistory,
    readRetroHistoryPreference: readPreference,
    saveRetroHistoryPreference: savePreference,
    isRetroHistorySuppressed: suppressed,
    scheduleCleanup,
    dispose,
    save: saveHistory,
    read: readHistory,
  };
  return persistence;
}

const defaultPersistence = createRetroHistoryPersistence();

export function saveRetroHistory(
  room: RetroRoom,
  viewerId?: string | null,
  policy?: RetroHistoryPolicy,
  persistence: RetroHistoryPersistence = defaultPersistence
): boolean {
  return persistence.saveRetroHistory(room, viewerId, policy);
}

export function readRetroHistory(
  persistence: RetroHistoryPersistence = defaultPersistence
): { entries: SavedRetro[]; error: string | null } {
  return persistence.readRetroHistory();
}

export function deleteRetroHistory(
  room: RetroRoom,
  persistence: RetroHistoryPersistence = defaultPersistence
): boolean {
  return persistence.deleteRetroHistory(room);
}

export function deleteAllRetroHistory(
  persistence: RetroHistoryPersistence = defaultPersistence
): boolean {
  return persistence.deleteAllRetroHistory();
}

export function readRetroHistoryPreference(
  room: Pick<RetroRoom, "code" | "expiresAt">,
  persistence: RetroHistoryPersistence = defaultPersistence
): RetroHistoryPreference | null {
  return persistence.readRetroHistoryPreference(room);
}

export function saveRetroHistoryPreference(
  room: Pick<RetroRoom, "code" | "expiresAt">,
  policy: RetroHistoryPolicy,
  persistence: RetroHistoryPersistence = defaultPersistence
): boolean {
  return persistence.saveRetroHistoryPreference(room, policy);
}

export function isRetroHistorySuppressed(
  room: Pick<RetroRoom, "code" | "expiresAt">,
  persistence: RetroHistoryPersistence = defaultPersistence
): boolean {
  return persistence.isRetroHistorySuppressed(room);
}
