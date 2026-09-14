import { test } from "node:test";
import assert from "node:assert/strict";
import { retroPriorities, priorityLabel } from "shared/retro-priorities";
import type { RetroRoom, RetroNote } from "shared/retrospective";
import { roomAsMarkdown, roomAsText } from "../lib/retro-export";
import { publicRetro } from "../lib/retro-history";

function note(
  id: string,
  voteCount: number,
  groupId: string | null = null
): RetroNote {
  return {
    id,
    voteCount,
    groupId,
    text: `Note ${id}`,
    authorId: "author",
    authorName: "Alice",
    column: "ideas",
    votedBySelf: false,
  };
}
const room: RetroRoom = {
  code: "room",
  title: "Ties",
  phase: "closed",
  expiresAt: 1000,
  members: [],
  actions: [],
  notes: [
    note("z-first", 2),
    note("m-second", 0, "theme"),
    note("a-third", 2),
    note("b-fourth", 0),
    note("c-fifth", 0, "theme"),
    note("d-sixth", 0),
  ],
  groups: [
    { id: "theme", title: "Theme second", voteCount: 2, votedBySelf: false },
  ],
};

test("ties share competition ranks and server note order, not random IDs", () => {
  const priorities = retroPriorities(room);
  assert.deepEqual(
    priorities.map(({ id, rank, tied }) => ({ id, rank, tied })),
    [
      { id: "z-first", rank: 1, tied: true },
      { id: "theme", rank: 1, tied: true },
      { id: "a-third", rank: 1, tied: true },
      { id: "b-fourth", rank: 4, tied: true },
      { id: "d-sixth", rank: 4, tied: true },
    ]
  );
  assert.equal(priorityLabel(priorities[1]), "Rank 1 (tied)");
  assert.deepEqual(
    retroPriorities(publicRetro(JSON.parse(JSON.stringify(room)))),
    priorities
  );
});

test("all-zero, unique, empty and deleted-note priorities remain deterministic", () => {
  assert.deepEqual(retroPriorities({ notes: [], groups: [] }), []);
  assert.deepEqual(
    retroPriorities({ notes: [note("z", 0), note("a", 0)], groups: [] }).map(
      ({ rank, tied }) => [rank, tied]
    ),
    [
      [1, true],
      [1, true],
    ]
  );
  assert.deepEqual(
    retroPriorities({ notes: [note("z", 1), note("a", 2)], groups: [] }).map(
      ({ id, rank, tied }) => [id, rank, tied]
    ),
    [
      ["a", 1, false],
      ["z", 2, false],
    ]
  );
  const deleted = {
    ...room,
    notes: room.notes.filter((note) => note.id !== "z-first"),
  };
  assert.equal(retroPriorities(deleted)[0].id, "theme");
});

test("Markdown and text use the same ranks and interleaved theme/note order", () => {
  for (const output of [roomAsMarkdown(room), roomAsText(room)]) {
    assert.equal(output.match(/Rank 1 \(tied\)/g)?.length, 3);
    assert.equal(output.match(/Rank 4 \(tied\)/g)?.length, 2);
    assert.ok(output.indexOf("Note z") < output.indexOf("Theme second"));
    assert.ok(output.indexOf("Theme second") < output.indexOf("Note a"));
    assert.ok(output.indexOf("Note a") < output.indexOf("Note b"));
  }
});
