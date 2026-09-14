import { z } from 'zod';
import type { RoomError } from './events.types.js';

const identifier = z.string().min(1).max(64);
const participantName = z.string().max(128);
const password = z.string().max(100);
const card = z.string().min(1).max(20);
const noData = z.undefined();

export const planningCommandSchemas = {
  'keep-alive': noData,
  'inspect-room': z.object({ room: identifier }).strict(),
  'create-room': z
    .object({
      name: participantName,
      cardSet: z.array(card).max(30).optional(),
      password: password.optional(),
    })
    .strict(),
  'join-room': z
    .object({
      name: participantName,
      room: identifier,
      password: password.optional(),
    })
    .strict(),
  reconnect: z.object({ token: identifier, room: identifier }).strict(),
  'cast-vote': z.object({ vote: z.string().max(20).nullable() }).strict(),
  'reveal-results': noData,
  'start-voting': noData,
  'claim-moderator': noData,
  'promote-user': z.object({ userId: identifier }).strict(),
  'kick-user': z.object({ userId: identifier }).strict(),
  'change-avatar': z
    .object({
      avatar: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  'broadcast-message': z
    .object({
      roomId: identifier,
      message: z.string().trim().min(1).max(1000),
      password: z.string().max(256),
    })
    .strict(),
} as const;

export const INVALID_COMMAND_ERROR = {
  event: 'invalid-command',
  data: { error: 'Invalid command payload.' },
} as const satisfies RoomError;
