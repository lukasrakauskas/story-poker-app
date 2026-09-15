import type { RetroSessionView, RetroCommand } from "shared/retrospective";

const validCode = (code: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(code);

type EstablishCommand = Extract<RetroCommand, { type: "create" | "join" }>;

type ErrorBody = { code?: unknown; message?: unknown };

export class RetroSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * The backend origin owns the room-scoped HttpOnly cookie. These helpers never
 * read document.cookie and never expose Set-Cookie to application JavaScript.
 */
export function retroApiOrigin(): string {
  const configured =
    process.env.NEXT_PUBLIC_RETRO_API_URL ?? process.env.NEXT_PUBLIC_WS_URL;
  const base =
    configured ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:4000");
  const url = new URL(base);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RetroSessionError(
      "configuration",
      0,
      "The retrospective API URL has an invalid protocol."
    );
  return url.origin;
}

function sessionPath(code: string, suffix = ""): string {
  if (!validCode(code))
    throw new RetroSessionError(
      "invalid-command",
      400,
      "Invalid retrospective room code."
    );
  return `/retro/session/${encodeURIComponent(code)}${suffix}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionView(value: unknown): value is RetroSessionView {
  if (!isObject(value) || !isObject(value.self) || !isObject(value.room))
    return false;
  return (
    typeof value.self.id === "string" &&
    typeof value.room.code === "string" &&
    validCode(value.room.code) &&
    Array.isArray(value.room.members) &&
    Array.isArray(value.room.notes) &&
    Array.isArray(value.room.groups) &&
    Array.isArray(value.room.actions)
  );
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  validate: (value: unknown) => value is T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${retroApiOrigin()}${path}`, {
      ...init,
      credentials: "include",
    });
  } catch {
    throw new RetroSessionError(
      "connection",
      0,
      "Unable to reach the retrospective server. Retry when your connection is available."
    );
  }
  const body = await parseBody(response);
  if (!response.ok) {
    const error = isObject(body) ? (body as ErrorBody) : {};
    throw new RetroSessionError(
      typeof error.code === "string" ? error.code : "connection",
      response.status,
      typeof error.message === "string"
        ? error.message
        : "The retrospective session request was rejected."
    );
  }
  if (!validate(body))
    throw new RetroSessionError(
      "connection",
      response.status,
      "The retrospective server returned an invalid session response."
    );
  return body;
}

export function establishRetroSession(
  command: EstablishCommand
): Promise<RetroSessionView> {
  return request(
    "/retro/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
    isSessionView
  );
}

export function resumeRetroSession(code: string): Promise<RetroSessionView> {
  return request(
    sessionPath(code, "/resume"),
    { method: "POST" },
    isSessionView
  );
}

export function inspectRetroSession(code: string): Promise<RetroSessionView> {
  return request(sessionPath(code), { method: "GET" }, isSessionView);
}

export async function forgetRetroSession(code: string): Promise<boolean> {
  const response = await request(
    sessionPath(code),
    { method: "DELETE" },
    (value: unknown): value is { forgotten: true } =>
      isObject(value) && value.forgotten === true
  );
  return response.forgotten;
}
