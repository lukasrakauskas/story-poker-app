import { test } from "node:test";
import assert from "node:assert/strict";
import {
  materializeRetroState,
  retroVersionStatus,
  type RetroStateData,
} from "shared/retrospective";

const room = {
  code: "retro",
  title: "Protocol",
  phase: "write" as const,
  expiresAt: 1_800_000_000_000,
  closedAt: null,
  requiresPassword: false,
  members: [
    {
      id: "alice",
      name: "Alice",
      moderator: true,
      connected: true,
      ready: false,
    },
  ],
  notes: [],
  groups: [],
  actions: [],
};

function state(overrides: Partial<RetroStateData> = {}): RetroStateData {
  return {
    room,
    self: { id: "alice" },
    recipient: { notes: [], votedNoteIds: [], votedGroupIds: [] },
    version: 4,
    ...overrides,
  };
}

test("materializes private writing and own votes without putting them in public data", () => {
  const privateNote = {
    id: "note",
    authorId: "alice",
    authorName: "Alice",
    column: "ideas" as const,
    text: "Only Alice",
    groupId: null,
    voteCount: null,
    votedBySelf: false,
  };
  const writing = state({
    recipient: { notes: [privateNote], votedNoteIds: [], votedGroupIds: [] },
  });
  assert.deepEqual(materializeRetroState(writing).notes, [privateNote]);
  assert.deepEqual(writing.room.notes, []);
  assert.equal(JSON.stringify(writing.room).includes("Only Alice"), false);
  assert.equal(JSON.stringify(writing.room).includes("secret"), false);

  const voting = state({
    room: {
      ...room,
      phase: "vote",
      notes: [privateNote],
      groups: [
        { id: "theme", title: "Theme", voteCount: null, votedBySelf: false },
      ],
    },
    recipient: {
      notes: [],
      votedNoteIds: ["note"],
      votedGroupIds: ["theme"],
    },
  });
  const materialized = materializeRetroState(voting);
  assert.equal(materialized.notes[0].votedBySelf, true);
  assert.equal(materialized.groups[0].votedBySelf, true);
  assert.deepEqual(voting.recipient.votedNoteIds, ["note"]);
});

test("classifies ordered, duplicate, and missed versions and permits only authoritative recovery", () => {
  assert.equal(retroVersionStatus(null, 8), "next");
  assert.equal(retroVersionStatus(8, 9), "next");
  assert.equal(retroVersionStatus(8, 8), "stale");
  assert.equal(retroVersionStatus(8, 7), "stale");
  assert.equal(retroVersionStatus(8, 10), "gap");
  assert.equal(retroVersionStatus(8, 10, true), "next");
});
