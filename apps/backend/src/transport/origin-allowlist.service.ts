import { Injectable } from '@nestjs/common';

const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/** One exact-origin policy is shared by HTTP CORS and retrospective WebSocket. */
@Injectable()
export class OriginAllowlistService {
  private readonly origins: Set<string>;

  constructor() {
    this.origins = new Set(readRetroAllowedOrigins());
  }

  isAllowed(origin: string | undefined): boolean {
    // Non-browser clients do not send Origin. A browser origin must match the
    // exact configured origin; no wildcard, path, or credentialed origin is
    // accepted.
    if (origin === undefined) return true;
    const normalized = normalizeHttpOrigin(origin);
    return normalized !== undefined && this.origins.has(normalized);
  }

  corsOrigin(
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) {
    callback(null, this.isAllowed(origin));
  }
}

export function readRetroAllowedOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = parseRetroOrigins(
    environment.RETRO_ALLOWED_ORIGINS ??
      environment.WS_ALLOWED_ORIGINS ??
      environment.WEBSOCKET_ALLOWED_ORIGINS ??
      '',
  );
  return configured.length > 0 || environment.NODE_ENV === 'production'
    ? configured
    : DEVELOPMENT_ORIGINS;
}

export function parseRetroOrigins(value = ''): string[] {
  return value
    .split(',')
    .map((origin) => normalizeHttpOrigin(origin.trim()))
    .filter((origin): origin is string => origin !== undefined);
}

export function normalizeHttpOrigin(origin: string): string | undefined {
  if (!origin || origin === '*') return undefined;
  try {
    const parsed = new URL(origin);
    if (
      !HTTP_PROTOCOLS.has(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    )
      return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
