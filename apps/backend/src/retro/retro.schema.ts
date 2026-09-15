import { z } from 'zod';
import {
  retroCodeSchema,
  retroCommandMessageSchema,
  retroCommandSchema,
  retroPasswordSchema,
  retroServerEventSchema,
  retroTitleSchema,
} from 'shared/retrospective';
import { participantNameSchema } from '../collaboration/participant.service.js';

/** The HTTP boundary accepts only entry commands and owns their cookie. */
export const retroSessionEstablishmentSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create'),
      name: participantNameSchema,
      title: retroTitleSchema,
      password: retroPasswordSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('join'),
      name: participantNameSchema,
      code: retroCodeSchema,
      password: retroPasswordSchema,
    })
    .strict(),
]);

export {
  retroCodeSchema,
  retroCommandMessageSchema,
  retroCommandSchema,
  retroServerEventSchema,
};
