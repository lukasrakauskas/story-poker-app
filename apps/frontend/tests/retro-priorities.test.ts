import { test } from "node:test";
import assert from "node:assert/strict";
import { retroPriorities } from "shared/retro-priorities";
import type { RetroNote, RetroRoom } from "shared/retrospective";
import { roomAsMarkdown, roomAsText } from "../lib/retro-export";

function note(
  id: string,
  voteCount: number,
  stackId: string | null = null
): RetroNote {
  return {
    id,
    authorId: "alice",
    authorName: "Alice",
    column: "ideas",
    text: id,
    stackId,
    voteCount,
    votedBySelf: false,
  };
}

const room: RetroRoom = {
  code: "retro",
  title: "Priorities",
  phase: "closed",
  expiresAt: 1_800_000_000_000,
  closedAt: 1_700_000_000_000,
  requiresPassword: false,
  members: [
    {
      id: "alice",
      name: "Alice",
      moderator: true,
      connected: false,
      ready: false,
    },
  ],
  notes: [
    note("z-first", 2),
    note("m-second", 1),
    note("a-third", 2),
    note("b-fourth", 0),
  ],
  actions: [],
};

test("ties share competition ranks and preserve server lane order", () => {
  assert.deepEqual(
    retroPriorities(room).map(({ id, rank, tied }) => ({ id, rank, tied })),
    [
      { id: "z-first", rank: 1, tied: true },
      { id: "a-third", rank: 1, tied: true },
      { id: "m-second", rank: 3, tied: false },
      { id: "b-fourth", rank: 4, tied: false },
    ]
  );
});

test("empty and reordered note priorities remain deterministic", () => {
  assert.deepEqual(retroPriorities({ notes: [] }), []);
  const reordered = { ...room, notes: [room.notes[2], room.notes[0]] };
  assert.deepEqual(
    retroPriorities(reordered).map((target) => target.id),
    ["a-third", "z-first"]
  );
});

test("discussion keeps stacks together and ranks their aggregate votes", () => {
  const stacked = {
    ...room,
    notes: [
      note("first", 2, "stack"),
      note("second", 1, "stack"),
      note("solo", 2),
    ],
  };
  const priorities = retroPriorities(stacked);
  assert.equal(priorities.length, 2);
  assert.equal(priorities[0].voteCount, 3);
  assert.deepEqual(
    priorities[0].notes.map((item) => item.id),
    ["first", "second"]
  );
  for (const output of [roomAsMarkdown(stacked), roomAsText(stacked)]) {
    assert.match(output, /3 votes · 2 grouped messages/);
    assert.match(output, /first/);
    assert.match(output, /second/);
  }
});

test("Markdown and text use the same individual-note ranks", () => {
  for (const output of [roomAsMarkdown(room), roomAsText(room)]) {
    assert.equal(output.match(/Rank 1 \(tied\)/g)?.length, 2);
    assert.match(output, /z\\?-first/);
    assert.match(output, /a\\?-third/);
    assert.doesNotMatch(output, /Theme/);
  }
});
