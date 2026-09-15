import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitService } from './rate-limit.service.js';
import {
  sourceKeyFromUpgradeRequest,
  WebSocketAdmissionService,
} from './websocket-admission.service.js';
import { TransportMetricsService } from './transport-metrics.service.js';

function request(
  remoteAddress: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    socket: { remoteAddress } as IncomingMessage['socket'],
    headers,
  } as IncomingMessage;
}

function admission(
  overrides: ConstructorParameters<typeof WebSocketAdmissionService>[2] = {},
) {
  return new WebSocketAdmissionService(
    new RateLimitService(),
    new TransportMetricsService(),
    overrides,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WebSocket source identity', () => {
  it('uses the peer address and ignores spoofed forwarding headers by default', () => {
    expect(
      sourceKeyFromUpgradeRequest(
        request('10.0.0.4', { 'x-forwarded-for': '198.51.100.4' }),
      ),
    ).toBe('ip:10.0.0.4');
  });

  it('uses the first forwarded address only after explicit trusted-proxy configuration', () => {
    const environment = {
      WS_TRUST_PROXY: 'true',
      WS_TRUSTED_PROXY_IPS: '10.0.0.4',
    };
    expect(
      sourceKeyFromUpgradeRequest(
        request('10.0.0.4', {
          'x-forwarded-for': '198.51.100.4, 10.0.0.8',
        }),
        undefined,
        environment,
      ),
    ).toBe('ip:198.51.100.4');
    expect(
      sourceKeyFromUpgradeRequest(
        request('10.0.0.5', { 'x-forwarded-for': '198.51.100.4' }),
        undefined,
        environment,
      ),
    ).toBe('ip:10.0.0.5');
    expect(
      sourceKeyFromUpgradeRequest(
        request('10.0.0.4', { 'x-forwarded-for': '198.51.100.4' }),
        undefined,
        { WS_TRUST_PROXY: 'true', WS_TRUSTED_PROXY_IPS: 'not-an-ip' },
      ),
    ).toBe('ip:10.0.0.4');
  });

  it('collapses missing or malformed addresses to a safe shared key', () => {
    expect(
      sourceKeyFromUpgradeRequest(
        request('not-an-ip', { 'x-forwarded-for': 'also-not-an-ip' }),
      ),
    ).toBe('unknown');
  });
});

describe('WebSocket admission controls', () => {
  it('bounds concurrent sockets while authenticated members leave the unauthenticated pool', () => {
    const controls = admission({
      maxActiveSockets: 3,
      maxActiveSocketsPerSource: 2,
      maxUnauthenticatedSockets: 2,
      maxUnauthenticatedPerSource: 2,
    });
    expect(controls.open('one', 'ip:10.0.0.1').allowed).toBe(true);
    expect(controls.open('two', 'ip:10.0.0.1').allowed).toBe(true);
    expect(controls.open('three', 'ip:10.0.0.1')).toMatchObject({
      allowed: false,
      reason: 'source-limit',
    });
    expect(controls.authenticate('one')).toBe(true);
    controls.release('two');
    expect(controls.open('three', 'ip:10.0.0.1').allowed).toBe(true);
    expect(controls.activeSockets()).toBe(2);
    expect(controls.activeUnauthenticatedSockets()).toBe(1);
    controls.release('one');
    controls.release('three');
    expect(controls.activeSockets()).toBe(0);
    expect(controls.sourceCount()).toBe(0);
  });

  it('keys create, join, resume, and password attempts by source across fresh sockets', () => {
    const controls = admission({
      maxCreateAttemptsPerSource: 2,
      maxJoinAttemptsPerSource: 2,
      maxResumeAttemptsPerSource: 1,
      maxPasswordAttemptsPerSource: 1,
      attemptWindowMs: 1_000,
    });
    controls.open('one', 'ip:10.0.0.1');
    controls.open('two', 'ip:10.0.0.1');
    expect(controls.consumeOperation('retro', 'one', 'join')).toBe(true);
    expect(controls.consumeOperation('retro', 'two', 'join')).toBe(true);
    expect(controls.consumeOperation('retro', 'one', 'join')).toBe(false);
    expect(controls.consumeOperation('retro', 'two', 'password')).toBe(true);
    expect(controls.consumeOperation('retro', 'one', 'password')).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(controls.consumeOperation('retro', 'one', 'join')).toBe(true);
    expect(controls.consumeOperation('retro', 'one', 'resume')).toBe(true);
    expect(controls.consumeOperation('retro', 'two', 'resume')).toBe(false);
  });

  it('opens global create and broadcast circuits without affecting room-local reads', () => {
    const metrics = new TransportMetricsService();
    const controls = new WebSocketAdmissionService(
      new RateLimitService(),
      metrics,
      {
        globalCreateLimit: 2,
        globalCreateWindowMs: 1_000,
        createCircuitCooldownMs: 100,
        broadcastBudget: 3,
        broadcastWindowMs: 1_000,
        broadcastCircuitCooldownMs: 100,
      },
    );
    expect(controls.allowRoomCreation('retro')).toBe(true);
    expect(controls.allowRoomCreation('retro')).toBe(true);
    expect(controls.allowRoomCreation('retro')).toBe(false);
    expect(controls.allowBroadcast('retro', 2)).toBe(true);
    expect(controls.allowBroadcast('retro', 2)).toBe(false);
    expect(
      metrics.counter('websocket.operations.throttled', {
        namespace: 'retro',
        operation: 'create',
      }),
    ).toBe(1);
    expect(
      metrics.counter('websocket.broadcasts.throttled', { namespace: 'retro' }),
    ).toBe(1);
    vi.advanceTimersByTime(100);
    expect(controls.allowRoomCreation('retro')).toBe(true);
    expect(controls.allowBroadcast('retro', 1)).toBe(true);
  });

  it('does not expose sensitive request fields through metrics', () => {
    const metrics = new TransportMetricsService();
    metrics.increment('websocket.test', {
      operation: 'join',
      token: 'credential-value',
      room: 'room-content',
    });
    expect(JSON.stringify(metrics.snapshot())).not.toContain(
      'credential-value',
    );
    expect(JSON.stringify(metrics.snapshot())).not.toContain('room-content');
    expect(metrics.counter('websocket.test', { operation: 'join' })).toBe(1);
  });

  it('does not grow limiter state past its configured bound', () => {
    const limits = new RateLimitService({ maxEntries: 2 });
    expect(limits.consume('test', 'one', { limit: 1, windowMs: 100 })).toBe(
      true,
    );
    expect(limits.consume('test', 'two', { limit: 1, windowMs: 100 })).toBe(
      true,
    );
    expect(limits.consume('test', 'three', { limit: 1, windowMs: 100 })).toBe(
      false,
    );
    expect(limits.size()).toBe(2);
    vi.advanceTimersByTime(100);
    expect(limits.consume('test', 'three', { limit: 1, windowMs: 100 })).toBe(
      true,
    );
    expect(limits.size()).toBe(1);
  });
});
