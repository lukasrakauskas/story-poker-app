import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { RetroRoom } from "shared/retrospective";
import {
  deleteRetroHistory,
  publicRetro,
  readRetroHistory,
  retroHistoryKey,
  saveRetroHistory,
  RETRO_HISTORY_PREFIX,
} from "../lib/retro-history";
import { roomAsMarkdown } from "../lib/retro-export";

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
  expiresAt: 1800000000000,
  members: [{ id: "alice", name: "Alice", moderator: true, connected: true }],
  notes: [
    {
      id: "note",
      authorId: "alice",
      text: "Good teamwork",
      column: "went-well",
      voterIds: ["alice"],
    },
  ],
  actions: [
    { id: "action", text: "Fix flaky tests", owner: "Alice", done: false },
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

test("ignores corrupt or unsupported entries without hiding valid history", () => {
  saveRetroHistory(room);
  storage.setItem(`${RETRO_HISTORY_PREFIX}broken`, "{invalid");
  storage.setItem(
    `${RETRO_HISTORY_PREFIX}future`,
    JSON.stringify({ version: 2, room })
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
        owner: "[Alice](https://example.com)",
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
      { id: "done", text: "Ship it", owner: "", done: true },
    ],
  });
  assert.match(markdown, /^# Sprint retro/m);
  assert.match(markdown, /Good teamwork/);
  assert.match(markdown, /1 votes?/);
  assert.match(markdown, /- \[ \] Fix flaky tests/);
  assert.match(markdown, /- \[x\] Ship it/);
  assert.match(markdown, /Unassigned/);
});
