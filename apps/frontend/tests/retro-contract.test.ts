import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrateRetroArchive,
  retroPublicRoomSchema,
} from "shared/retrospective";
import { parseRetroServerEvent } from "../lib/retro-protocol";
import { sanitizePublicRetroRoom } from "../lib/retro-history";

const room = {
  code: "room",
  title: "Retro",
  phase: "discuss" as const,
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
  notes: [
    {
      id: "note",
      authorId: "alice",
      authorName: "Alice",
      column: "ideas" as const,
      text: "Keep pairing",
      groupId: null,
      voteCount: 1,
      votedBySelf: false,
    },
  ],
  groups: [],
  actions: [],
};

test("frontend validates complete nested server events with the shared schema", () => {
  const event = {
    event: "retro-state" as const,
    data: { room, self: { id: "alice", token: "private-token" } },
  };
  assert.deepEqual(parseRetroServerEvent(event), event);
  assert.equal(
    parseRetroServerEvent({
      ...event,
      data: {
        ...event.data,
        room: {
          ...room,
          actions: [{ id: "action", text: "bad", owner: {}, done: false }],
        },
      },
    }),
    null
  );
  assert.equal(
    parseRetroServerEvent({
      ...event,
      data: { ...event.data, unknown: true },
    }),
    null
  );
});

test("archive projection drops reconnect secrets before strict public parsing", () => {
  const privateRoom = {
    ...room,
    token: "private-token",
    members: room.members.map((member) => ({
      ...member,
      token: "private-token",
    })),
    notes: room.notes.map((note) => ({ ...note, voterIds: ["alice"] })),
    actions: [
      {
        id: "action",
        text: "Follow up",
        owner: { kind: "external", name: "Team", token: "private-token" },
        done: false,
      },
    ],
  };
  const sanitized = sanitizePublicRetroRoom(privateRoom);
  assert.equal(JSON.stringify(sanitized).includes("private-token"), false);
  assert.equal(JSON.stringify(sanitized).includes("voterIds"), false);
  assert.equal(retroPublicRoomSchema.safeParse(sanitized).success, true);
});

test("migrates retro-history-v1 voter identities into recipient-safe fields", () => {
  const migrated = migrateRetroArchive({
    version: 1,
    savedAt: 1,
    viewerId: "alice",
    room: {
      code: "room",
      title: "Retro",
      phase: "vote",
      expiresAt: 1_800_000_000_000,
      members: room.members,
      notes: [
        {
          id: "note",
          authorId: "alice",
          column: "ideas",
          text: "Keep pairing",
          voterIds: ["alice", "former-voter"],
        },
      ],
      actions: [],
    },
  });
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.entry.version, 3);
  assert.deepEqual(migrated.entry.room.notes[0], {
    id: "note",
    authorId: "alice",
    authorName: "Former member",
    column: "ideas",
    text: "Keep pairing",
    groupId: null,
    voteCount: null,
    votedBySelf: true,
  });
  assert.equal(JSON.stringify(migrated).includes("voterIds"), false);
});
