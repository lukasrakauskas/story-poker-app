import { z } from 'zod';
import type { RetroCommand } from 'shared/retrospective';
import { participantNameSchema } from '../collaboration/participant.service.js';

const id = z.string().min(1).max(64);
const text = z.string().trim().min(1).max(1000);
const name = participantNameSchema;
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
    z.object({
      type: z.literal('add-note'),
      column: z.enum(['went-well', 'improve', 'ideas']),
      text,
    }),
    z.object({ type: z.literal('edit-note'), id, text }),
    z.object({ type: z.literal('delete-note'), id }),
    z.object({ type: z.literal('toggle-vote'), id }),
    z.object({ type: z.literal('advance') }),
    z.object({
      type: z.literal('add-action'),
      text,
      owner: z.string().trim().max(60),
    }),
    z.object({ type: z.literal('toggle-action'), id }),
    z.object({ type: z.literal('delete-action'), id }),
  ],
);
