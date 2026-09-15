import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  isWebSocketOriginAllowed,
  parseWebSocketOrigins,
  verifyWebSocketClient,
} from './websocket-origin-policy.js';

const request = {
  headers: { origin: 'https://retro.example.test' },
} as IncomingMessage;

describe('WebSocket origin policy', () => {
  it('allows local development without silently imposing a production allowlist', () => {
    expect(isWebSocketOriginAllowed(undefined, { production: false })).toBe(
      true,
    );
    expect(
      isWebSocketOriginAllowed('http://localhost:3000', { production: false }),
    ).toBe(true);
  });

  it('fails closed in production unless an exact origin is configured', () => {
    expect(
      isWebSocketOriginAllowed('https://retro.example.test', {
        production: true,
      }),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed('https://retro.example.test', {
        production: true,
        allowedOrigins:
          'https://retro.example.test/,https://admin.example.test',
      }),
    ).toBe(true);
    expect(
      isWebSocketOriginAllowed('https://evil.example.test', {
        production: true,
        allowedOrigins: 'https://retro.example.test',
      }),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed(undefined, {
        production: true,
        allowedOrigins: 'https://retro.example.test',
      }),
    ).toBe(false);
    expect(
      isWebSocketOriginAllowed(undefined, {
        production: true,
        allowedOrigins: 'https://retro.example.test',
        allowNoOrigin: true,
      }),
    ).toBe(true);
  });

  it('rejects wildcard, credentialed, and path-bearing allowlist entries', () => {
    expect(
      parseWebSocketOrigins(
        '*,https://retro.example.test/room,user:pass@https://bad.test',
      ),
    ).toEqual([]);
    expect(
      isWebSocketOriginAllowed('https://retro.example.test', {
        production: true,
        allowedOrigins: '*',
      }),
    ).toBe(false);
  });

  it('uses the request origin supplied by ws during the upgrade', () => {
    expect(
      verifyWebSocketClient(
        {
          origin: 'https://retro.example.test',
          req: request,
        },
        { NODE_ENV: 'test' },
      ),
    ).toBe(true);
  });
});
