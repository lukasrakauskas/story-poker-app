import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';

export type RateLimitServiceOptions = {
  /** Maximum number of fixed-window keys retained by this process. */
  maxEntries?: number;
};

/**
 * Replacement seam for a shared atomic store when replicas are introduced.
 * Implementations must preserve the fixed-window decision semantics; the
 * in-memory RateLimitService below is the local default. Replace the provider
 * with an atomic shared implementation rather than adding replica-local
 * counters when horizontal scaling is enabled.
 */
export interface RateLimitStore {
  consume(
    namespace: string,
    key: string,
    options: { limit: number; windowMs: number },
  ): boolean;
  release(namespace: string, key: string): void;
  clear(namespace: string): void;
}

export const RATE_LIMIT_OPTIONS = Symbol('RATE_LIMIT_OPTIONS');

type Window = {
  startedAt: number;
  count: number;
  windowMs: number;
};

const DEFAULT_MAX_ENTRIES = 10_000;
const ABSOLUTE_MAX_ENTRIES = 100_000;
const PRUNE_INTERVAL_MS = 1_000;

/**
 * Bounded fixed-window limiter shared by WebSocket gateways.
 *
 * A rejected new key never evicts an existing key. That makes a stream of
 * forged source keys unable to reset active users' windows, while expiry and
 * explicit release keep the map bounded in normal operation.
 */
@Injectable()
export class RateLimitService implements RateLimitStore, OnModuleDestroy {
  private readonly windows = new Map<string, Window>();
  private readonly maxEntries: number;
  private lastPrunedAt = 0;

  constructor(
    @Optional()
    @Inject(RATE_LIMIT_OPTIONS)
    options?: RateLimitServiceOptions,
  ) {
    const configured = options?.maxEntries;
    this.maxEntries =
      configured !== undefined && Number.isFinite(configured) && configured > 0
        ? Math.min(Math.floor(configured), ABSOLUTE_MAX_ENTRIES)
        : DEFAULT_MAX_ENTRIES;
  }

  consume(
    namespace: string,
    key: string,
    options: { limit: number; windowMs: number },
  ): boolean {
    const now = Date.now();
    const scopedKey = `${namespace}\0${key}`;
    let window = this.windows.get(scopedKey);
    if (
      window &&
      (now - window.startedAt >= window.windowMs ||
        window.windowMs !== options.windowMs)
    ) {
      window = undefined;
      this.windows.delete(scopedKey);
    }
    if (!window) {
      this.prune(now);
      if (this.windows.size >= this.maxEntries) {
        this.prune(now, true);
        if (this.windows.size >= this.maxEntries) return false;
      }
      window = { startedAt: now, count: 0, windowMs: options.windowMs };
      this.windows.set(scopedKey, window);
    }
    return ++window.count <= options.limit;
  }

  release(namespace: string, key: string): void {
    this.windows.delete(`${namespace}\0${key}`);
  }

  clear(namespace: string): void {
    const prefix = `${namespace}\0`;
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) this.windows.delete(key);
    }
  }

  /** Number of retained limiter windows, useful for health/operational tests. */
  size(): number {
    return this.windows.size;
  }

  onModuleDestroy(): void {
    this.windows.clear();
  }

  private prune(now: number, force = false): void {
    if (!force && now - this.lastPrunedAt < PRUNE_INTERVAL_MS) return;
    this.lastPrunedAt = now;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= window.windowMs) this.windows.delete(key);
    }
  }
}
