import { z } from "zod";

/**
 * The participant identity boundary is shared by browser forms and backend
 * collaboration services. Protocol schemas should compose this schema rather
 * than repeat name normalization or length rules.
 */
export const PARTICIPANT_NAME_MIN_LENGTH = 3;
export const PARTICIPANT_NAME_MAX_LENGTH = 30;

export const participantNameSchema = z
  .string()
  .trim()
  .min(
    PARTICIPANT_NAME_MIN_LENGTH,
    `Name must be at least ${PARTICIPANT_NAME_MIN_LENGTH} characters after trimming spaces`
  )
  .max(
    PARTICIPANT_NAME_MAX_LENGTH,
    `Name must be at most ${PARTICIPANT_NAME_MAX_LENGTH} characters after trimming spaces`
  );

export function normalizeParticipantName(name: unknown): string {
  return typeof name === "string" ? name.trim() : "";
}

export function validateParticipantName(name: unknown): string | null {
  const parsed = participantNameSchema.safeParse(name);
  return parsed.success
    ? null
    : parsed.error.issues.map((issue) => issue.message).join(", ");
}
