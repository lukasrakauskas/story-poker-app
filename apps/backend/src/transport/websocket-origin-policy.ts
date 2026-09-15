import { Logger } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

export type WebSocketOriginPolicyOptions = {
  allowedOrigins?: string;
  production?: boolean;
  allowNoOrigin?: boolean;
};

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const logger = new Logger('WebSocketOriginPolicy');
let lastOriginRejectionLogAt = Number.NEGATIVE_INFINITY;

/**
 * Parse an exact-origin allowlist. Wildcards are intentionally not accepted;
 * production deployments must name every browser origin explicitly.
 */
export function parseWebSocketOrigins(value = ''): string[] {
  return value
    .split(',')
    .map((origin) => normalizeHttpOrigin(origin.trim()))
    .filter((origin): origin is string => origin !== undefined);
}

export function isWebSocketOriginAllowed(
  origin: string | undefined,
  options: WebSocketOriginPolicyOptions = readWebSocketOriginPolicy(),
): boolean {
  const configured = parseWebSocketOrigins(options.allowedOrigins ?? '');
  if (!origin && options.allowNoOrigin) return true;
  if (configured.length > 0) {
    const candidate =
      typeof origin === 'string' ? normalizeHttpOrigin(origin) : undefined;
    return candidate !== undefined && configured.includes(candidate);
  }
  if (options.production) return false;
  return true;
}

/** The ws server calls this before completing an upgrade handshake. */
export function verifyWebSocketClient(
  info: { origin: string; req: IncomingMessage },
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const origin = info.origin || headerValue(info.req.headers.origin);
  const allowed = isWebSocketOriginAllowed(
    origin,
    readWebSocketOriginPolicy(environment),
  );
  const now = Date.now();
  if (!allowed && now - lastOriginRejectionLogAt >= 1_000) {
    lastOriginRejectionLogAt = now;
    logger.warn('websocket upgrade rejected by origin policy');
  }
  return allowed;
}

export function readWebSocketOriginPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): WebSocketOriginPolicyOptions {
  return {
    allowedOrigins:
      environment.WS_ALLOWED_ORIGINS ?? environment.WEBSOCKET_ALLOWED_ORIGINS,
    production: environment.NODE_ENV === 'production',
    allowNoOrigin: environment.WS_ALLOW_NO_ORIGIN === 'true',
  };
}

function normalizeHttpOrigin(origin: string): string | undefined {
  if (!origin || origin === '*') return;
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
      return;
    return parsed.origin;
  } catch {
    return;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
