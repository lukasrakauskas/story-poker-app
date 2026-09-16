import {
  retroServerEventSchema,
  type RetroServerEvent,
} from "shared/retrospective";

/** Parse a complete event before any recipient state or archive is changed. */
export function parseRetroServerEvent(value: unknown): RetroServerEvent | null {
  const parsed = retroServerEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
