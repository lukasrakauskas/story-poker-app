import { z } from 'zod';
import type { RetroCommand } from 'shared/retrospective';
import { participantNameSchema } from '../collaboration/participant.service.js';

const id = z.string().min(1).max(64);
const text = z.string().trim().min(1).max(1000);
const name = participantNameSchema;
const owner = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unassigned') }),
  z.object({ kind: z.literal('participant'), participantId: id }),
  z.object({
    kind: z.literal('external'),
    name: z.string().trim().min(1).max(60),
  }),
]);
export const retroCommandSchema: z.ZodType<RetroCommand> = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('create'),
      name,
      title: z.string().trim().min(1).max(100),
    }),
    z.object({ type: z.literal('join'), name, code: id }),
    z.object({ type: z.literal('resume'), code: id, token: id }),
    z.object({ type: z.literal('refresh') }),
    z.object({
      type: z.literal('add-note'),
      column: z.enum(['went-well', 'improve', 'ideas']),
      text,
    }),
    z.object({ type: z.literal('edit-note'), id, text }),
    z.object({ type: z.literal('delete-note'), id }),
    z.object({
      type: z.literal('group-notes'),
      title: z.string().trim().min(1).max(100),
      noteIds: z.array(id).min(2).max(300),
    }),
    z.object({ type: z.literal('ungroup-note'), id }),
    z.object({ type: z.literal('move-note'), id, groupId: id }),
    z.object({ type: z.literal('remove-member'), memberId: id }),
    z.object({ type: z.literal('toggle-vote'), id }),
    z.object({ type: z.literal('toggle-ready') }),
    z.object({ type: z.literal('transfer-moderator'), memberId: id }),
    z.object({ type: z.literal('claim-moderator') }),
    z.object({ type: z.literal('advance') }),
    z.object({
      type: z.literal('add-action'),
      text,
      owner,
    }),
    z.object({ type: z.literal('edit-action'), id, text, owner }),
    z.object({ type: z.literal('toggle-action'), id }),
    z.object({ type: z.literal('delete-action'), id }),
  ],
);
