import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { RetroRoom } from "shared/retrospective";
import {
  deleteRetroHistory,
  publicRetro,
  readRetroHistory,
  retroHistoryKey,
  saveRetroHistory as persistRetroHistory,
  saveRetroHistoryPreference,
  readRetroHistoryPreference,
  deleteAllRetroHistory,
  isRetroHistorySuppressed,
  createRetroHistoryPersistence,
  type RetroHistoryPolicy,
  RETRO_HISTORY_PREFIX,
} from "../lib/retro-history";
import { roomAsMarkdown, roomAsText } from "../lib/retro-export";

class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
let storage: MemoryStorage;
const recoveryPolicy = {
  mode: "recovery" as const,
  retention: "forever" as const,
};

function saveRetroHistory(
  room: RetroRoom,
  viewerId?: string | null,
  policy: RetroHistoryPolicy = recoveryPolicy
) {
  return persistRetroHistory(room, viewerId, policy);
}

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
});
afterEach(() => {
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const room: RetroRoom = {
  code: "room-123",
  title: "Sprint retro",
  phase: "discuss",
  closedAt: null,
  requiresPassword: false,
  expiresAt: 1800000000000,
  members: [
    {
      id: "alice",
      name: "Alice",
      moderator: true,
      connected: true,
      ready: false,
    },
  ],
  notes: [
    {
      id: "note",
      authorId: "alice",
      authorName: "Alice",
      text: "Good teamwork",
      column: "went-well",
      groupId: null,
      voteCount: 1,
      votedBySelf: false,
    },
  ],
  groups: [],
  actions: [
    {
      id: "action",
      text: "Fix flaky tests",
      owner: { kind: "participant", participantId: "alice", name: "Alice" },
      done: false,
    },
  ],
};

test("updates a single snapshot, stores final actions, and preserves separate rooms and lifetimes", () => {
  assert.equal(saveRetroHistory(room), true);
  const closed = {
    ...room,
    phase: "closed" as const,
    actions: [{ ...room.actions[0], done: true }],
  };
  assert.equal(saveRetroHistory(closed), true);
  assert.equal(saveRetroHistory(room), true); // A stale live tab must not overwrite a final snapshot.
  assert.equal(readRetroHistory().entries.length, 1);
  assert.deepEqual(readRetroHistory().entries[0].room, closed);
  saveRetroHistory({ ...room, code: "second" });
  saveRetroHistory({ ...room, expiresAt: room.expiresAt + 1 });
  assert.equal(readRetroHistory().entries.length, 3);
  assert.equal(deleteRetroHistory(closed), true);
  assert.equal(readRetroHistory().entries.length, 2);
  assert.equal(storage.getItem(retroHistoryKey(closed)), null);
});

test("requires an explicit policy and keeps the safe final-only default out of live storage", () => {
  assert.equal(persistRetroHistory(room), false);
  assert.equal(storage.length, 0);
  assert.equal(
    persistRetroHistory(room, "alice", {
      mode: "final-only",
      retention: "30d",
    }),
    false
  );
  assert.equal(storage.length, 0);
  saveRetroHistory(room);
  assert.equal(
    saveRetroHistoryPreference(room, {
      mode: "final-only",
      retention: "30d",
    }),
    true
  );
  assert.equal(storage.getItem(retroHistoryKey(room)), null);
  const closed = { ...room, phase: "closed" as const, closedAt: 900 };
  assert.equal(
    persistRetroHistory(closed, "alice", {
      mode: "final-only",
      retention: "30d",
    }),
    true
  );
  const saved = JSON.parse(storage.getItem(retroHistoryKey(closed))!);
  assert.equal(saved.room.phase, "closed");
  assert.equal(saved.retentionUntil - saved.savedAt, 30 * 24 * 60 * 60 * 1000);
});

test("the explicit no-history choice removes an existing copy and prevents future saves", () => {
  saveRetroHistory(room);
  assert.equal(
    saveRetroHistoryPreference(room, {
      mode: "none",
      retention: "30d",
    }),
    true
  );
  assert.deepEqual(readRetroHistoryPreference(room), {
    mode: "none",
    retention: "30d",
  });
  assert.equal(storage.getItem(retroHistoryKey(room)), null);
  assert.equal(saveRetroHistory(room), false);
  assert.equal(isRetroHistorySuppressed(room), true);
});

test("stores room-scoped choices and suppresses a live tab after per-room deletion", () => {
  const choice = { mode: "recovery" as const, retention: "7d" as const };
  assert.equal(saveRetroHistoryPreference(room, choice), true);
  assert.deepEqual(readRetroHistoryPreference(room), choice);
  assert.equal(saveRetroHistory(room, undefined, choice), true);
  assert.equal(deleteRetroHistory(room), true);
  assert.equal(isRetroHistorySuppressed(room), true);
  assert.equal(
    persistRetroHistory(room, "alice", {
      mode: "recovery",
      retention: "forever",
    }),
    false
  );
  assert.equal(readRetroHistory().entries.length, 0);

  // Re-enabling is another explicit choice, not a side effect of a stale tab.
  assert.equal(saveRetroHistoryPreference(room, choice), true);
  assert.equal(isRetroHistorySuppressed(room), false);
  assert.equal(saveRetroHistory(room, undefined, choice), true);
});

test("Delete all removes every archive and suppresses open rooms until reselected", () => {
  const second = { ...room, code: "second" };
  saveRetroHistory(room);
  saveRetroHistory(second);
  assert.equal(deleteAllRetroHistory(), true);
  assert.equal(readRetroHistory().entries.length, 0);
  assert.equal(isRetroHistorySuppressed(room), true);
  assert.equal(isRetroHistorySuppressed(second), true);
  assert.equal(saveRetroHistory(room), false);
  assert.equal(saveRetroHistory(second), false);

  assert.equal(
    saveRetroHistoryPreference(room, {
      mode: "recovery",
      retention: "forever",
    }),
    true
  );
  assert.equal(isRetroHistorySuppressed(room), false);
  assert.equal(saveRetroHistory(room), true);
  assert.equal(isRetroHistorySuppressed(second), true);
});

test("cleans entries at their retention deadline and exposes a scheduler seam", () => {
  let now = 1_000_000;
  let scheduled: (() => void) | null = null;
  let delay = -1;
  let cleared = false;
  const persistence = createRetroHistoryPersistence({
    storage,
    eventTarget: new EventTarget(),
    clock: () => now,
    scheduler: {
      setTimeout(callback, timeout) {
        scheduled = callback;
        delay = timeout;
        return callback;
      },
      clearTimeout() {
        cleared = true;
      },
    },
  });
  assert.equal(
    persistence.saveRetroHistory(room, "alice", {
      mode: "recovery",
      retention: "7d",
    }),
    true
  );
  const saved = JSON.parse(storage.getItem(retroHistoryKey(room))!);
  const second = { ...room, code: "second" };
  assert.equal(
    persistence.saveRetroHistory(second, "alice", {
      mode: "recovery",
      retention: "7d",
    }),
    true
  );
  now = saved.retentionUntil;
  const cleanup = scheduled as (() => void) | null;
  assert.ok(cleanup);
  cleanup!();
  assert.equal(storage.getItem(retroHistoryKey(room)), null);
  assert.equal(storage.getItem(retroHistoryKey(second)), null);
  persistence.scheduleCleanup(250);
  assert.equal(delay, 250);
  assert.ok(scheduled);
  persistence.dispose();
  assert.equal(cleared, true);
});

test("write-phase history and exports retain only the current participant's notes", () => {
  const writing: RetroRoom = {
    ...room,
    phase: "write",
    members: [
      ...room.members,
      {
        id: "bob",
        name: "Bob",
        moderator: false,
        connected: true,
        ready: false,
      },
    ],
    notes: [
      room.notes[0],
      {
        id: "guest-note",
        authorId: "bob",
        authorName: "Bob",
        text: "Guest private thought",
        column: "ideas",
        groupId: null,
        voteCount: null,
        votedBySelf: false,
      },
    ],
  };

  assert.equal(saveRetroHistory(writing, "alice"), true);
  const stored = storage.getItem(retroHistoryKey(writing))!;
  assert.ok(stored.includes("Good teamwork"));
  assert.ok(!stored.includes("Guest private thought"));
  assert.ok(
    !roomAsMarkdown(writing, "alice").includes("Guest private thought")
  );
  assert.deepEqual(publicRetro(writing).notes, []);

  // Old write-phase entries did not record their audience, so fail closed
  // rather than re-exposing notes that may have belonged to someone else.
  const legacyWriting = {
    ...writing,
    notes: writing.notes.map(
      ({
        voteCount: _voteCount,
        votedBySelf: _votedBySelf,
        authorName: _authorName,
        ...note
      }) => ({
        ...note,
        voterIds: [note.authorId],
      })
    ),
  };
  storage.setItem(
    retroHistoryKey(writing),
    JSON.stringify({ version: 1, savedAt: 1, room: legacyWriting })
  );
  assert.deepEqual(readRetroHistory().entries[0].room.notes, []);
  const migrated = storage.getItem(retroHistoryKey(writing))!;
  assert.ok(!migrated.includes("Guest private thought"));
  assert.ok(!migrated.includes("voterIds"));
  assert.equal(JSON.parse(migrated).version, 3);
});

test("migrates free-text owners without guessing identities and exports removed assignments", () => {
  storage.setItem(
    retroHistoryKey(room),
    JSON.stringify({
      version: 2,
      savedAt: 1,
      room: {
        ...room,
        actions: [
          { id: "old", text: "Legacy", owner: "Alice", done: true },
          { id: "empty", text: "No owner", owner: "", done: false },
        ],
      },
    })
  );
  const migrated = readRetroHistory().entries[0];
  assert.equal(migrated.version, 3);
  assert.deepEqual(
    migrated.room.actions.map((action) => action.owner),
    [{ kind: "external", name: "Alice" }, { kind: "unassigned" }]
  );
  assert.equal(JSON.parse(storage.getItem(retroHistoryKey(room))!).version, 3);
  const removed = { ...room, members: [] };
  assert.equal(saveRetroHistory(removed), true);
  const saved = readRetroHistory().entries[0].room;
  assert.deepEqual(saved.actions[0].owner, room.actions[0].owner);
  assert.match(roomAsMarkdown(saved), /Owner: Alice/);
  assert.match(roomAsText(saved), /Fix flaky tests — Alice/);
  assert.deepEqual(publicRetro(saved).actions[0].owner, room.actions[0].owner);
});

test("completed history keeps its first content and saved time across repeated closed snapshots", () => {
  const closed: RetroRoom = { ...room, phase: "closed", closedAt: 500 };
  assert.equal(saveRetroHistory(closed), true);
  const original = storage.getItem(retroHistoryKey(closed));
  assert.equal(
    saveRetroHistory({
      ...closed,
      title: "Changed after closing",
      members: [],
      closedAt: 999,
    }),
    true
  );
  assert.equal(saveRetroHistory(room), true);
  assert.equal(storage.getItem(retroHistoryKey(closed)), original);
  assert.deepEqual(readRetroHistory().entries[0].room, closed);
  assert.equal(storage.getItem(retroHistoryKey(closed)), original);
  assert.match(roomAsMarkdown(closed), /Completed: 1970-01-01T00:00:00.500Z/);
  assert.match(roomAsText(closed), /Completed: 1970-01-01T00:00:00.500Z/);
});

test("preserves grouped themes in history and exports", () => {
  const grouped: RetroRoom = {
    ...room,
    groups: [
      {
        id: "theme",
        title: "Delivery flow",
        voteCount: 2,
        votedBySelf: false,
      },
    ],
    notes: [{ ...room.notes[0], groupId: "theme", voteCount: null }],
  };
  assert.equal(saveRetroHistory(grouped), true);
  assert.equal(
    readRetroHistory().entries[0].room.groups[0].title,
    "Delivery flow"
  );
  const markdown = roomAsMarkdown(grouped);
  assert.match(markdown, /### Delivery flow · 2 votes/);
  assert.match(markdown, /Good teamwork — Alice/);
});

test("retains note author snapshots after a participant is removed", () => {
  const removed = { ...room, members: [] };
  assert.equal(saveRetroHistory(removed), true);
  assert.equal(readRetroHistory().entries[0].room.notes[0].authorName, "Alice");
  assert.match(roomAsMarkdown(removed), /Good teamwork — Alice/);
});

test("allowlists history and exports without retaining reconnect secrets", () => {
  const withSecrets = {
    ...room,
    token: "top-secret",
    self: { token: "top-secret" },
    members: room.members.map((member) => ({ ...member, token: "top-secret" })),
  };
  assert.equal(saveRetroHistory(withSecrets), true);
  const stored = storage.getItem(retroHistoryKey(room))!;
  assert.ok(!stored.includes("top-secret"));
  assert.ok(!JSON.stringify(publicRetro(withSecrets)).includes("token"));
  assert.ok(!roomAsMarkdown(withSecrets).includes("top-secret"));
});

test("migrates legacy voter identities to private selections or aggregate counts", () => {
  const legacyNotes = room.notes.map(
    ({
      voteCount: _voteCount,
      votedBySelf: _votedBySelf,
      authorName: _authorName,
      ...note
    }) => ({
      ...note,
      voterIds: ["alice", "former-voter"],
    })
  );
  storage.setItem(
    retroHistoryKey(room),
    JSON.stringify({
      version: 1,
      savedAt: 1,
      viewerId: "alice",
      room: { ...room, phase: "vote", notes: legacyNotes },
    })
  );
  let migrated = readRetroHistory().entries[0];
  assert.equal(migrated.version, 3);
  assert.equal(migrated.room.notes[0].voteCount, null);
  assert.equal(migrated.room.notes[0].votedBySelf, true);
  assert.equal(migrated.room.notes[0].authorName, "Alice");
  assert.ok(!storage.getItem(retroHistoryKey(room))!.includes("voterIds"));
  assert.ok(!storage.getItem(retroHistoryKey(room))!.includes("former-voter"));

  storage.setItem(
    retroHistoryKey(room),
    JSON.stringify({
      version: 1,
      savedAt: 2,
      viewerId: "alice",
      room: { ...room, phase: "closed", notes: legacyNotes },
    })
  );
  migrated = readRetroHistory().entries[0];
  assert.equal(migrated.room.notes[0].voteCount, 2);
  assert.equal(migrated.room.notes[0].votedBySelf, false);
  assert.ok(!roomAsMarkdown(migrated.room).includes("former-voter"));

  // A stale live snapshot must preserve the final archive while still
  // scrubbing identities from its legacy representation.
  storage.setItem(
    retroHistoryKey(room),
    JSON.stringify({
      version: 1,
      savedAt: 2,
      viewerId: "alice",
      room: { ...room, phase: "closed", notes: legacyNotes },
    })
  );
  assert.equal(saveRetroHistory(room, "alice"), true);
  const preserved = storage.getItem(retroHistoryKey(room))!;
  assert.equal(JSON.parse(preserved).room.phase, "closed");
  assert.ok(!preserved.includes("voterIds"));
});

test("ignores corrupt or unsupported entries without hiding valid history", () => {
  saveRetroHistory(room);
  storage.setItem(`${RETRO_HISTORY_PREFIX}broken`, "{invalid");
  storage.setItem(
    `${RETRO_HISTORY_PREFIX}future`,
    JSON.stringify({ version: 3, room })
  );
  storage.setItem("unrelated", "leave me alone");
  const result = readRetroHistory();
  assert.equal(result.entries.length, 1);
  assert.match(result.error!, /could not be read/);
  deleteRetroHistory(room);
  assert.equal(storage.getItem("unrelated"), "leave me alone");
});

test("storage denial and quota exhaustion return failures without throwing or erasing older entries", () => {
  saveRetroHistory(room);
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.equal(saveRetroHistory({ ...room, title: "New title" }), false);
  assert.equal(
    saveRetroHistoryPreference(room, {
      mode: "recovery",
      retention: "30d",
    }),
    false
  );
  assert.equal(readRetroHistory().entries[0].room.title, room.title);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  assert.equal(saveRetroHistory(room), false);
  assert.equal(deleteRetroHistory(room), false);
  assert.match(readRetroHistory().error!, /unavailable/);
});

test("Markdown escapes user formatting and HTML without allowing multiline list injection", () => {
  const markdown = roomAsMarkdown({
    ...room,
    title: "<script> & [title]",
    notes: [{ ...room.notes[0], text: "**bold**\n# injected\r\n- [x] fake" }],
    actions: [
      {
        ...room.actions[0],
        text: "<img src=x>\nnext step",
        owner: { kind: "external", name: "[Alice](https://example.com)" },
      },
    ],
  });
  assert.ok(markdown.includes("&lt;script&gt; &amp; \\[title\\]"));
  assert.ok(
    markdown.includes("\\*\\*bold\\*\\*<br>\\# injected<br>\\- \\[x\\] fake")
  );
  assert.ok(markdown.includes("&lt;img src=x&gt;<br>next step"));
  assert.ok(!markdown.includes("\n# injected"));
});

test("Markdown contains notes, votes, owners, and completed/open action checkboxes", () => {
  const markdown = roomAsMarkdown({
    ...room,
    actions: [
      ...room.actions,
      {
        id: "done",
        text: "Ship it",
        owner: { kind: "unassigned" },
        done: true,
      },
    ],
  });
  assert.match(markdown, /^# Sprint retro/m);
  assert.match(markdown, /Good teamwork/);
  assert.match(markdown, /1 votes?/);
  assert.match(markdown, /- \[ \] Fix flaky tests/);
  assert.match(markdown, /- \[x\] Ship it/);
  assert.match(markdown, /Unassigned/);
});
