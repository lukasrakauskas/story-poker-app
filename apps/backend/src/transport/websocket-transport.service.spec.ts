import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { result } from './application-result.js';
import { RateLimitService } from './rate-limit.service.js';
import { WebSocketHeartbeatService } from './websocket-heartbeat.service.js';
import { WebSocketTransportService } from './websocket-transport.service.js';

function socket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    ping: vi.fn(),
  } as unknown as WebSocket;
}

afterEach(() => vi.useRealTimers());

describe('WebSocket transport adapters', () => {
  it('maps connection IDs to serialized sends, closes, and responses', () => {
    const transport = new WebSocketTransportService();
    const client = socket();
    expect(transport.register(client, 'connection')).toBe('connection');
    expect(
      transport.dispatch(
        result(
          { event: 'response', data: null },
          [{ connectionId: 'connection', event: { event: 'update' } }],
          [{ connectionId: 'connection', code: 4000, reason: 'Replaced' }],
        ),
      ),
    ).toEqual({ event: 'response', data: null });
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'update' }),
    );
    expect(client.close).toHaveBeenCalledWith(4000, 'Replaced');
    expect(transport.unregister(client)).toBe('connection');
  });

  it('isolates heartbeat policy from gateways', () => {
    vi.useFakeTimers();
    const heartbeat = new WebSocketHeartbeatService();
    const client = socket();
    const timedOut = vi.fn();
    heartbeat.register('test', client);
    heartbeat.start('test', {
      interval: 1000,
      probe: { type: 'ping' },
      onTimeout: timedOut,
    });
    vi.advanceTimersByTime(1000);
    expect(client.ping).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(client.terminate).toHaveBeenCalledOnce();
    expect(timedOut).toHaveBeenCalledWith(client);
    heartbeat.stop('test');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies keyed fixed-window rate limits', () => {
    vi.useFakeTimers();
    const limits = new RateLimitService();
    expect(
      limits.consume('retro', 'connection', { limit: 1, windowMs: 1000 }),
    ).toBe(true);
    expect(
      limits.consume('retro', 'connection', { limit: 1, windowMs: 1000 }),
    ).toBe(false);
    expect(limits.consume('retro', 'other', { limit: 1, windowMs: 1000 })).toBe(
      true,
    );
    vi.advanceTimersByTime(1000);
    expect(
      limits.consume('retro', 'connection', { limit: 1, windowMs: 1000 }),
    ).toBe(true);
  });
});
