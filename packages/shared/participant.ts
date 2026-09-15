import { z } from "zod";

export const PARTICIPANT_NAME_MIN_LENGTH = 3;
export const PARTICIPANT_NAME_MAX_LENGTH = 30;

/** The canonical participant name contract shared by every collaboration domain. */
export const participantNameSchema = z
  .string()
  .trim()
  .min(
    PARTICIPANT_NAME_MIN_LENGTH,
    "Name must be at least 3 characters after trimming spaces"
  )
  .max(
    PARTICIPANT_NAME_MAX_LENGTH,
    "Name must be at most 30 characters after trimming spaces"
  );

export function normalizeParticipantName(name: unknown): string {
  return typeof name === "string" ? name.trim() : "";
}

export function participantNameError(name: unknown): string | null {
  const parsed = participantNameSchema.safeParse(name);
  return parsed.success ? null : parsed.error.format()._errors.join(", ");
}
