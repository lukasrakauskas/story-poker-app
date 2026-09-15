export interface RetroReconnectPolicyOptions {
  /** Delay before the first automatic attempt. */
  initialDelayMs?: number;
  /** Upper bound for the exponential delay, including jitter. */
  maxDelayMs?: number;
  /** Symmetric jitter as a fraction of the exponential delay. */
  jitterRatio?: number;
  /** Injectable source of randomness for deterministic lifecycle tests. */
  random?: () => number;
}

export interface RetroReconnectAttempt {
  number: number;
  delayMs: number;
}

export interface RetroReconnectPolicy {
  readonly attempt: number;
  next(): RetroReconnectAttempt;
  reset(): void;
}

const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER_RATIO = 0.25;

/**
 * Calculate one bounded exponential delay. The random source is deliberately
 * supplied by the caller so reconnect timing can be tested without sleeping.
 */
export function reconnectDelay(
  attempt: number,
  {
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    jitterRatio = DEFAULT_JITTER_RATIO,
    random = Math.random,
  }: RetroReconnectPolicyOptions = {}
): number {
  const initial = Math.max(0, initialDelayMs);
  const maximum = Math.max(0, maxDelayMs);
  const jitter = Math.min(1, Math.max(0, jitterRatio));
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  const exponential = Math.min(maximum, initial * 2 ** Math.min(exponent, 30));
  const sampleValue = random();
  const sample = Number.isFinite(sampleValue)
    ? Math.min(1, Math.max(0, sampleValue))
    : 0.5;
  const withJitter = exponential * (1 + (sample * 2 - 1) * jitter);
  return Math.min(maximum, Math.max(0, Math.round(withJitter)));
}

/**
 * Keep reconnect policy independent from socket and React state. A policy
 * bounds delay rather than attempt count: a room remains recoverable until a
 * server-authoritative terminal error arrives.
 */
export function createRetroReconnectPolicy(
  options: RetroReconnectPolicyOptions = {}
): RetroReconnectPolicy {
  let attempt = 0;

  return {
    get attempt() {
      return attempt;
    },
    next() {
      attempt += 1;
      return {
        number: attempt,
        delayMs: reconnectDelay(attempt, options),
      };
    },
    reset() {
      attempt = 0;
    },
  };
}

export const retroReconnectDefaults = {
  initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  jitterRatio: DEFAULT_JITTER_RATIO,
} as const;
