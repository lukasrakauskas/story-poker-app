import { z } from "zod";
import { participantNameSchema } from "./participant";

/**
 * The wire protocol deliberately stays at v1 while its schemas evolve behind
 * one exported contract. Archive versions are independent from the wire
 * protocol because local history has a different migration cadence.
 */
export const RETRO_PROTOCOL_VERSION = 1 as const;
export const RETRO_ARCHIVE_VERSION = 3 as const;
export const RETRO_HISTORY_KEY_VERSION = 1 as const;

export const RETRO_PROTOCOL_ERROR_CODE = "protocol-error" as const;
export const RETRO_PROTOCOL_ERROR_MESSAGE =
  "Received an invalid retrospective response. Retry to get a fresh room snapshot.";

export const RETRO_MAX_ROOMS = 100;
export const RETRO_MAX_MEMBERS = 30;
export const RETRO_MAX_NOTES = 300;
export const RETRO_MAX_ACTIONS = 100;
export const RETRO_MAX_VOTES_PER_MEMBER = 3;
export const RETRO_MAX_ID_LENGTH = 64;
export const RETRO_MAX_TITLE_LENGTH = 100;
export const RETRO_MAX_TEXT_LENGTH = 1000;
export const RETRO_MAX_EXTERNAL_OWNER_LENGTH = 60;
export const RETRO_MAX_TIMESTAMP = 8.64e15;

export const retroProtocolVersionSchema = z.literal(RETRO_PROTOCOL_VERSION);
export const retroArchiveVersionSchema = z.literal(RETRO_ARCHIVE_VERSION);

export const retroIdSchema = z.string().min(1).max(RETRO_MAX_ID_LENGTH);
export const retroTokenSchema = retroIdSchema;
export const retroRequestIdSchema = retroIdSchema;
export const retroCodeSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const retroTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(RETRO_MAX_TITLE_LENGTH);
export const retroTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(RETRO_MAX_TEXT_LENGTH);
export const retroTimestampSchema = z
  .number()
  .int()
  .nonnegative()
  .max(RETRO_MAX_TIMESTAMP);

export const retroColumnSchema = z.enum(["went-well", "improve", "ideas"]);
export const retroPhaseSchema = z.enum([
  "write",
  "group",
  "vote",
  "discuss",
  "closed",
]);

export const retroActionOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unassigned") }).strict(),
  z
    .object({
      kind: z.literal("participant"),
      participantId: retroIdSchema,
      name: participantNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("external"),
      name: z.string().trim().min(1).max(RETRO_MAX_EXTERNAL_OWNER_LENGTH),
    })
    .strict(),
]);

export const retroActionAssignmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unassigned") }).strict(),
  z
    .object({ kind: z.literal("participant"), participantId: retroIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("external"),
      name: z.string().trim().min(1).max(RETRO_MAX_EXTERNAL_OWNER_LENGTH),
    })
    .strict(),
]);

const voteCountSchema = z
  .number()
  .int()
  .min(0)
  .max(RETRO_MAX_MEMBERS)
  .nullable();
const voterIdsSchema = z
  .array(retroIdSchema)
  .max(RETRO_MAX_MEMBERS)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "A voter can occur only once in a target.",
      });
  });

export const retroPublicMemberSchema = z
  .object({
    id: retroIdSchema,
    name: participantNameSchema,
    moderator: z.boolean(),
    connected: z.boolean(),
    ready: z.boolean(),
  })
  .strict();

export const retroPublicNoteSchema = z
  .object({
    id: retroIdSchema,
    authorId: retroIdSchema,
    /** A display snapshot is public; resume credentials are never part of it. */
    authorName: participantNameSchema,
    column: retroColumnSchema,
    text: retroTextSchema,
    groupId: retroIdSchema.nullable(),
    voteCount: voteCountSchema,
    votedBySelf: z.boolean(),
  })
  .strict();

export const retroPublicGroupSchema = z
  .object({
    id: retroIdSchema,
    title: retroTitleSchema,
    voteCount: voteCountSchema,
    votedBySelf: z.boolean(),
  })
  .strict();

export const retroActionSchema = z
  .object({
    id: retroIdSchema,
    text: retroTextSchema,
    owner: retroActionOwnerSchema,
    done: z.boolean(),
  })
  .strict();

const publicRoomShape = {
  code: retroCodeSchema,
  title: retroTitleSchema,
  phase: retroPhaseSchema,
  expiresAt: retroTimestampSchema,
  closedAt: retroTimestampSchema.nullable(),
  members: z.array(retroPublicMemberSchema).max(RETRO_MAX_MEMBERS),
  notes: z.array(retroPublicNoteSchema).max(RETRO_MAX_NOTES),
  groups: z.array(retroPublicGroupSchema).max(RETRO_MAX_NOTES),
  actions: z.array(retroActionSchema).max(RETRO_MAX_ACTIONS),
};

/** Secret-free recipient snapshot. This is also the archive/export source. */
export const retroPublicRoomSchema = z.object(publicRoomShape).strict();
export const retroPublicSnapshotSchema = retroPublicRoomSchema;
export const retroRoomSchema = retroPublicRoomSchema;
export const retroSnapshotSchema = retroPublicRoomSchema;

/**
 * Internal state is intentionally a different schema from the public room.
 * It may contain reconnect tokens and voter identities, but it is never a
 * network or archive payload.
 */
export const retroInternalParticipantSchema = z
  .object({
    id: retroIdSchema,
    name: participantNameSchema,
    role: z.enum(["participant", "moderator"]),
    token: retroTokenSchema,
    connected: z.boolean(),
  })
  .strict();

export const retroInternalNoteSchema = z
  .object({
    id: retroIdSchema,
    authorId: retroIdSchema,
    authorName: participantNameSchema,
    column: retroColumnSchema,
    text: retroTextSchema,
    groupId: retroIdSchema.nullable(),
    voterIds: voterIdsSchema,
  })
  .strict();

export const retroInternalGroupSchema = z
  .object({
    id: retroIdSchema,
    title: retroTitleSchema,
    voterIds: voterIdsSchema,
  })
  .strict();

export const retroInternalRoomSchema = z
  .object({
    ...publicRoomShape,
    members: z.array(retroInternalParticipantSchema).max(RETRO_MAX_MEMBERS),
    notes: z.array(retroInternalNoteSchema).max(RETRO_MAX_NOTES),
    groups: z.array(retroInternalGroupSchema).max(RETRO_MAX_NOTES),
    readyMemberIds: z.set(retroIdSchema).max(RETRO_MAX_MEMBERS),
  })
  .strict();
export const retroPrivateRoomSchema = retroInternalRoomSchema;

export const retroSessionSchema = z
  .object({
    code: retroCodeSchema,
    id: retroIdSchema,
    token: retroTokenSchema,
  })
  .strict();

const uniqueNoteIdsSchema = z
  .array(retroIdSchema)
  .min(2)
  .max(RETRO_MAX_NOTES)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Note IDs must be unique.",
      });
  });

/** Strict v1 command contract. Request IDs live in the transport envelope. */
export const retroCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create"),
      name: participantNameSchema,
      title: retroTitleSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("join"),
      name: participantNameSchema,
      code: retroCodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("resume"),
      code: retroCodeSchema,
      token: retroTokenSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("add-note"),
      column: retroColumnSchema,
      text: retroTextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("edit-note"),
      id: retroIdSchema,
      text: retroTextSchema,
    })
    .strict(),
  z.object({ type: z.literal("delete-note"), id: retroIdSchema }).strict(),
  z
    .object({
      type: z.literal("group-notes"),
      title: retroTitleSchema,
      noteIds: uniqueNoteIdsSchema,
    })
    .strict(),
  z.object({ type: z.literal("ungroup-note"), id: retroIdSchema }).strict(),
  z
    .object({
      type: z.literal("move-note"),
      id: retroIdSchema,
      groupId: retroIdSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("remove-member"), memberId: retroIdSchema })
    .strict(),
  z.object({ type: z.literal("toggle-vote"), id: retroIdSchema }).strict(),
  z.object({ type: z.literal("toggle-ready") }).strict(),
  z
    .object({
      type: z.literal("transfer-moderator"),
      memberId: retroIdSchema,
    })
    .strict(),
  z.object({ type: z.literal("claim-moderator") }).strict(),
  z.object({ type: z.literal("advance") }).strict(),
  z
    .object({
      type: z.literal("add-action"),
      text: retroTextSchema,
      owner: retroActionAssignmentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("edit-action"),
      id: retroIdSchema,
      text: retroTextSchema,
      owner: retroActionAssignmentSchema,
    })
    .strict(),
  z.object({ type: z.literal("toggle-action"), id: retroIdSchema }).strict(),
  z.object({ type: z.literal("delete-action"), id: retroIdSchema }).strict(),
]);

/** The command shape sent over WebSocket, including acknowledgement metadata. */
export const retroCommandMessageSchema = retroCommandSchema.and(
  z.object({ requestId: retroRequestIdSchema.optional() }).strict()
);

export const retroClientSelfSchema = z
  .object({ id: retroIdSchema, token: retroTokenSchema })
  .strict();

/** Recipient-specific state includes that recipient's resume token. */
export const retroClientStateSchema = z
  .object({
    room: retroPublicRoomSchema,
    self: retroClientSelfSchema,
    requestId: retroRequestIdSchema.optional(),
  })
  .strict();

export const retroStateEventSchema = z
  .object({
    event: z.literal("retro-state"),
    data: retroClientStateSchema,
  })
  .strict();

export const retroErrorDataSchema = z
  .object({
    code: retroIdSchema,
    message: z.string().min(1).max(RETRO_MAX_TEXT_LENGTH),
    requestId: retroRequestIdSchema.optional(),
  })
  .strict();

export const retroErrorEventSchema = z
  .object({
    event: z.literal("retro-error"),
    data: retroErrorDataSchema,
  })
  .strict();

/** Strict v1 union used at both the backend boundary and the browser boundary. */
export const retroServerEventSchema = z.discriminatedUnion("event", [
  retroStateEventSchema,
  retroErrorEventSchema,
]);
export const retroEventSchema = retroServerEventSchema;

function legacyActionOwnerSchema() {
  return z.union([
    retroActionOwnerSchema,
    z
      .string()
      .max(RETRO_MAX_EXTERNAL_OWNER_LENGTH)
      .transform((name) => {
        const normalized = name.trim();
        return normalized
          ? { kind: "external" as const, name: normalized }
          : { kind: "unassigned" as const };
      }),
  ]);
}

const legacyMemberSchema = z
  .object({
    id: retroIdSchema,
    name: participantNameSchema,
    moderator: z.boolean(),
    connected: z.boolean(),
    // Version 1/2 archives predate readiness.
    ready: z.boolean().default(false),
  })
  .strict();

const legacyRoomBaseShape = {
  code: retroCodeSchema,
  title: retroTitleSchema,
  phase: retroPhaseSchema,
  expiresAt: retroTimestampSchema,
  closedAt: retroTimestampSchema.nullable().default(null),
  members: z.array(legacyMemberSchema).max(RETRO_MAX_MEMBERS),
  groups: z.array(retroPublicGroupSchema).max(RETRO_MAX_NOTES).default([]),
  actions: z
    .array(
      z
        .object({
          id: retroIdSchema,
          text: retroTextSchema,
          owner: legacyActionOwnerSchema(),
          done: z.boolean(),
        })
        .strict()
    )
    .max(RETRO_MAX_ACTIONS),
};

const legacyNoteShape = {
  id: retroIdSchema,
  authorId: retroIdSchema,
  // Older archives did not retain this display snapshot.
  authorName: participantNameSchema.default("Former member"),
  column: retroColumnSchema,
  text: retroTextSchema,
  groupId: retroIdSchema.nullable().default(null),
};

/** Existing `retro-history-v1` entries with private voter identity arrays. */
export const retroArchiveV1Schema = z
  .object({
    version: z.literal(1),
    savedAt: retroTimestampSchema,
    viewerId: retroIdSchema.optional(),
    room: z
      .object({
        ...legacyRoomBaseShape,
        notes: z
          .array(
            z.object({ ...legacyNoteShape, voterIds: voterIdsSchema }).strict()
          )
          .max(RETRO_MAX_NOTES),
      })
      .strict(),
  })
  .strict();

/** Version 2 kept public selections but may omit newer defaults or use text owners. */
export const retroArchiveV2Schema = z
  .object({
    version: z.literal(2),
    savedAt: retroTimestampSchema,
    viewerId: retroIdSchema.optional(),
    room: z
      .object({
        ...legacyRoomBaseShape,
        notes: z.array(retroPublicNoteSchema).max(RETRO_MAX_NOTES),
      })
      .strict(),
  })
  .strict();

/** Current token-free browser archive. */
export const retroArchiveSchema = z
  .object({
    version: retroArchiveVersionSchema,
    savedAt: retroTimestampSchema,
    viewerId: retroIdSchema.optional(),
    room: retroPublicRoomSchema,
  })
  .strict();

export type RetroColumn = z.infer<typeof retroColumnSchema>;
export type RetroPhase = z.infer<typeof retroPhaseSchema>;
export type RetroMember = z.infer<typeof retroPublicMemberSchema>;
export type RetroNote = z.infer<typeof retroPublicNoteSchema>;
export type RetroGroup = z.infer<typeof retroPublicGroupSchema>;
export type RetroActionOwner = z.infer<typeof retroActionOwnerSchema>;
export type RetroActionAssignment = z.infer<typeof retroActionAssignmentSchema>;
export type RetroAction = z.infer<typeof retroActionSchema>;
export type RetroRoom = z.infer<typeof retroPublicRoomSchema>;
export type RetroPublicSnapshot = z.infer<typeof retroPublicSnapshotSchema>;
export type RetroInternalParticipant = z.infer<
  typeof retroInternalParticipantSchema
>;
export type RetroInternalNote = z.infer<typeof retroInternalNoteSchema>;
export type RetroInternalGroup = z.infer<typeof retroInternalGroupSchema>;
export type RetroInternalRoom = z.infer<typeof retroInternalRoomSchema>;
export type RetroPrivateRoom = z.infer<typeof retroPrivateRoomSchema>;
export type RetroSession = z.infer<typeof retroSessionSchema>;
export type RetroCommand = z.infer<typeof retroCommandSchema>;
export type RetroCommandMessage = z.infer<typeof retroCommandMessageSchema>;
export type RetroClientSelf = z.infer<typeof retroClientSelfSchema>;
export type RetroClientState = z.infer<typeof retroClientStateSchema>;
export type RetroErrorData = z.infer<typeof retroErrorDataSchema>;
export type RetroServerEvent = z.infer<typeof retroServerEventSchema>;
export type RetroArchive = z.infer<typeof retroArchiveSchema>;

export function actionOwnerLabel(owner: RetroActionOwner): string {
  return owner.kind === "unassigned" ? "Unassigned" : owner.name;
}

/**
 * Parse current history or deliberately migrate one older archive shape. This
 * function never returns a legacy `voterIds` array: migration turns it into
 * recipient-owned selection state for voting or anonymous aggregate counts
 * after discussion. Callers can then run the public-room sanitizer again.
 */
export function migrateRetroArchive(value: unknown): {
  entry: RetroArchive;
  migrated: boolean;
} {
  const current = retroArchiveSchema.safeParse(value);
  if (current.success) return { entry: current.data, migrated: false };

  const versionTwo = retroArchiveV2Schema.safeParse(value);
  if (versionTwo.success) {
    return {
      entry: retroArchiveSchema.parse({
        ...versionTwo.data,
        version: RETRO_ARCHIVE_VERSION,
      }),
      migrated: true,
    };
  }

  const legacy = retroArchiveV1Schema.parse(value);
  return {
    entry: retroArchiveSchema.parse({
      version: RETRO_ARCHIVE_VERSION,
      savedAt: legacy.savedAt,
      ...(legacy.viewerId ? { viewerId: legacy.viewerId } : {}),
      room: {
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
      },
    }),
    migrated: true,
  };
}
