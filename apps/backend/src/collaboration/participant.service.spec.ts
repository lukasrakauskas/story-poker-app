import { describe, expect, it } from 'vitest';
import {
  participantNameError,
  participantNameSchema,
} from 'shared/participant';
import { retroCommandSchema } from '../retro/retro.schema.js';
import { ParticipantService } from './participant.service.js';

const participantNames = [
  ['blank', '', false],
  ['padded short', '  ab  ', false],
  ['exactly three characters', 'abc', true],
  ['padded valid', '  Alice  ', true],
  ['oversized', ` ${'a'.repeat(31)} `, false],
] as const;

describe('shared participant name contract', () => {
  it.each(participantNames)(
    'validates the normalized %s name consistently',
    (_label, input, valid) => {
      const parsed = participantNameSchema.safeParse(input);
      const participants = new ParticipantService();

      expect(parsed.success).toBe(valid);
      if (valid) {
        expect(participantNameError(input)).toBeNull();
        expect(participants.validateName(input)).toBeNull();
        if (!parsed.success) throw new Error(parsed.error.message);
        expect(parsed.data).toBe(input.trim());
        expect(participants.create(input).name).toBe(input.trim());
      } else {
        expect(participantNameError(input)).toEqual(expect.any(String));
        expect(participants.validateName(input)).toEqual(expect.any(String));
      }
    },
  );

  it('lets retrospective commands compose the shared normalized schema', () => {
    expect(
      retroCommandSchema.parse({
        type: 'create',
        name: '  abc  ',
        title: 'Retro',
      }),
    ).toMatchObject({ name: 'abc' });
    expect(
      retroCommandSchema.safeParse({
        type: 'join',
        name: '  ab  ',
        code: 'room',
      }).success,
    ).toBe(false);
  });
});
