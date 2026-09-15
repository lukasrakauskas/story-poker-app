import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { WebSocket } from 'ws';
import { RateLimitService } from './rate-limit.service.js';
import { TransportMetricsService } from './transport-metrics.service.js';

export const WEBSOCKET_ADMISSION_POLICY = Symbol('WEBSOCKET_ADMISSION_POLICY');
export const UNKNOWN_SOURCE = 'unknown';
export const ADMISSION_CLOSE_CODE = 1013;
export const ADMISSION_CLOSE_REASON =
  'Connection limit reached. Try again later.';

export type AdmissionOperation =
  | 'create'
  | 'join'
  | 'resume'
  | 'password'
  | 'inspect'
  | 'forget';

export type WebSocketAdmissionPolicy = {
  maxActiveSockets: number;
  maxActiveSocketsPerSource: number;
  maxUnauthenticatedSockets: number;
  maxUnauthenticatedPerSource: number;
  attemptWindowMs: number;
  maxCreateAttemptsPerSource: number;
  maxJoinAttemptsPerSource: number;
  maxResumeAttemptsPerSource: number;
  maxPasswordAttemptsPerSource: number;
  globalCreateLimit: number;
  globalCreateWindowMs: number;
  createCircuitCooldownMs: number;
  broadcastBudget: number;
  broadcastWindowMs: number;
  broadcastCircuitCooldownMs: number;
};

export type WebSocketAdmissionPolicyOverrides =
  Partial<WebSocketAdmissionPolicy>;

export type AdmissionDecision = {
  allowed: boolean;
  reason?: 'global-limit' | 'source-limit' | 'unauthenticated-limit';
};

type TrackedConnection = { source: string; authenticated: boolean };
type SourceCounts = { sockets: number; unauthenticated: number };
type Circuit = { startedAt: number; spent: number; openUntil: number };

const DEFAULT_POLICY: WebSocketAdmissionPolicy = {
  maxActiveSockets: 500,
  maxActiveSocketsPerSource: 64,
  maxUnauthenticatedSockets: 250,
  maxUnauthenticatedPerSource: 64,
  attemptWindowMs: 60_000,
  maxCreateAttemptsPerSource: 10,
  maxJoinAttemptsPerSource: 60,
  maxResumeAttemptsPerSource: 30,
  maxPasswordAttemptsPerSource: 5,
  globalCreateLimit: 20,
  globalCreateWindowMs: 60_000,
  createCircuitCooldownMs: 10_000,
  broadcastBudget: 5_000,
  broadcastWindowMs: 1_000,
  broadcastCircuitCooldownMs: 2_000,
};

const SOURCE_RATE_NAMESPACE = 'source-operations';
const CIRCUIT_CREATE = 'room-create';
const CIRCUIT_BROADCAST = 'broadcast';
const MAX_CIRCUITS = 32;

/**
 * Transport-level admission controls for unauthenticated WebSocket traffic.
 *
 * A connection is associated with its source once, then operation windows are
 * keyed by that source rather than by the socket. Authenticated room members
 * stop consuming the unauthenticated pool, which allows a normal team behind
 * one NAT to keep its room connections while fresh unauthenticated sockets
 * remain bounded.
 */
@Injectable()
export class WebSocketAdmissionService implements OnModuleDestroy {
  private readonly policy: WebSocketAdmissionPolicy;
  private readonly connections = new Map<string, TrackedConnection>();
  private readonly sources = new Map<string, SourceCounts>();
  private readonly circuits = new Map<string, Circuit>();

  constructor(
    private readonly rateLimits: RateLimitService,
    private readonly metrics: TransportMetricsService,
    @Optional()
    @Inject(WEBSOCKET_ADMISSION_POLICY)
    overrides?: WebSocketAdmissionPolicyOverrides,
  ) {
    this.policy = resolvePolicy(overrides);
  }

  open(
    connectionId: string,
    source: string,
    namespace = 'retro',
  ): AdmissionDecision {
    if (this.connections.has(connectionId)) return { allowed: true };
    const safeSource = normalizeSourceKey(source);
    const sourceCounts = this.sources.get(safeSource);
    if (this.connections.size >= this.policy.maxActiveSockets) {
      this.metrics.recordConnectionRejected(namespace, 'global-limit');
      return { allowed: false, reason: 'global-limit' };
    }
    if (
      sourceCounts &&
      sourceCounts.sockets >= this.policy.maxActiveSocketsPerSource
    ) {
      this.metrics.recordConnectionRejected(namespace, 'source-limit');
      return { allowed: false, reason: 'source-limit' };
    }
    const unauthenticated = this.unauthenticatedCount();
    if (unauthenticated >= this.policy.maxUnauthenticatedSockets) {
      this.metrics.recordConnectionRejected(namespace, 'unauthenticated-limit');
      return { allowed: false, reason: 'unauthenticated-limit' };
    }
    if (
      sourceCounts &&
      sourceCounts.unauthenticated >= this.policy.maxUnauthenticatedPerSource
    ) {
      this.metrics.recordConnectionRejected(namespace, 'unauthenticated-limit');
      return { allowed: false, reason: 'unauthenticated-limit' };
    }

    this.connections.set(connectionId, {
      source: safeSource,
      authenticated: false,
    });
    const next = sourceCounts ?? { sockets: 0, unauthenticated: 0 };
    next.sockets++;
    next.unauthenticated++;
    this.sources.set(safeSource, next);
    this.updateGauges();
    return { allowed: true };
  }

  authenticate(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.authenticated) return false;
    connection.authenticated = true;
    const counts = this.sources.get(connection.source);
    if (counts)
      counts.unauthenticated = Math.max(0, counts.unauthenticated - 1);
    this.updateGauges();
    return true;
  }

  release(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;
    this.connections.delete(connectionId);
    const counts = this.sources.get(connection.source);
    if (counts) {
      counts.sockets = Math.max(0, counts.sockets - 1);
      if (!connection.authenticated)
        counts.unauthenticated = Math.max(0, counts.unauthenticated - 1);
      if (counts.sockets === 0) this.sources.delete(connection.source);
    }
    this.updateGauges();
    return true;
  }

  consumeOperation(
    namespace: string,
    connectionId: string,
    operation: AdmissionOperation,
  ): boolean {
    const source = this.connections.get(connectionId)?.source ?? UNKNOWN_SOURCE;
    return this.consumeSourceOperation(namespace, source, operation);
  }

  /** Apply the same source-scoped window to HTTP entry/session operations. */
  consumeHttpOperation(
    namespace: string,
    source: string,
    operation: AdmissionOperation,
  ): boolean {
    return this.consumeSourceOperation(namespace, source, operation);
  }

  private consumeSourceOperation(
    namespace: string,
    source: string,
    operation: AdmissionOperation,
  ): boolean {
    const safeSource = normalizeSourceKey(source);
    const limit = this.operationLimit(operation);
    const allowed = this.rateLimits.consume(
      SOURCE_RATE_NAMESPACE,
      `${namespace}\0${operation}\0${safeSource}`,
      { limit, windowMs: this.policy.attemptWindowMs },
    );
    if (!allowed) this.metrics.recordOperationThrottled(namespace, operation);
    return allowed;
  }

  /** Process-wide room-create circuit, independent of individual sockets. */
  allowRoomCreation(namespace: string): boolean {
    const allowed = this.consumeCircuit(
      `${namespace}\0${CIRCUIT_CREATE}`,
      this.policy.globalCreateLimit,
      this.policy.globalCreateWindowMs,
      this.policy.createCircuitCooldownMs,
      1,
    );
    if (!allowed) this.metrics.recordOperationThrottled(namespace, 'create');
    return allowed;
  }

  /**
   * Charge a full-state broadcast by its audience size. A room with many
   * clients therefore trips the circuit sooner than a small room, while the
   * per-connection command limit remains the primary normal-user guard.
   */
  allowBroadcast(namespace: string, audienceSize: number): boolean {
    const cost = Math.max(1, Math.floor(audienceSize));
    const allowed = this.consumeCircuit(
      `${namespace}\0${CIRCUIT_BROADCAST}`,
      this.policy.broadcastBudget,
      this.policy.broadcastWindowMs,
      this.policy.broadcastCircuitCooldownMs,
      cost,
    );
    if (!allowed) this.metrics.recordBroadcastThrottled(namespace);
    return allowed;
  }

  activeSockets(): number {
    return this.connections.size;
  }

  activeUnauthenticatedSockets(): number {
    return this.unauthenticatedCount();
  }

  sourceCount(): number {
    return this.sources.size;
  }

  clear(): void {
    this.connections.clear();
    this.sources.clear();
    this.circuits.clear();
    this.rateLimits.clear(SOURCE_RATE_NAMESPACE);
    this.updateGauges();
  }

  onModuleDestroy(): void {
    this.clear();
  }

  private operationLimit(operation: AdmissionOperation): number {
    switch (operation) {
      case 'create':
        return this.policy.maxCreateAttemptsPerSource;
      case 'join':
        return this.policy.maxJoinAttemptsPerSource;
      case 'resume':
        return this.policy.maxResumeAttemptsPerSource;
      case 'password':
        return this.policy.maxPasswordAttemptsPerSource;
      case 'inspect':
        return this.policy.maxJoinAttemptsPerSource;
      case 'forget':
        return this.policy.maxResumeAttemptsPerSource;
    }
  }

  private consumeCircuit(
    key: string,
    limit: number,
    windowMs: number,
    cooldownMs: number,
    cost: number,
  ): boolean {
    const now = Date.now();
    let circuit = this.circuits.get(key);
    if (!circuit && this.circuits.size >= MAX_CIRCUITS) return false;
    if (circuit?.openUntil) {
      if (circuit.openUntil > now) return false;
      circuit = { startedAt: now, spent: 0, openUntil: 0 };
      this.circuits.set(key, circuit);
    } else if (!circuit || now - circuit.startedAt >= windowMs) {
      circuit = { startedAt: now, spent: 0, openUntil: 0 };
      this.circuits.set(key, circuit);
    }
    if (cost > limit || circuit.spent + cost > limit) {
      circuit.openUntil = now + cooldownMs;
      return false;
    }
    circuit.spent += cost;
    return true;
  }

  private unauthenticatedCount(): number {
    let count = 0;
    for (const connection of this.connections.values())
      if (!connection.authenticated) count++;
    return count;
  }

  private updateGauges(): void {
    this.metrics.setGauge('websocket.active_sockets', this.connections.size, {
      namespace: 'retro',
    });
    this.metrics.setGauge(
      'websocket.active_unauthenticated_sockets',
      this.unauthenticatedCount(),
      { namespace: 'retro' },
    );
  }
}

export function sourceKeyFromUpgradeRequest(
  request?: IncomingMessage,
  socket?: WebSocket,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const direct = normalizeIp(
    request?.socket?.remoteAddress ??
      request?.connection?.remoteAddress ??
      socketRemoteAddress(socket),
  );
  const trustProxy =
    environment.WS_TRUST_PROXY === 'true' ||
    environment.TRUST_PROXY === 'true' ||
    environment.WEBSOCKET_TRUST_PROXY === 'true';
  const trustedProxySetting =
    environment.WS_TRUSTED_PROXY_IPS ?? environment.TRUSTED_PROXY_IPS;
  const trustedProxyIps = parseIpList(trustedProxySetting);
  const hasTrustedProxyList = Boolean(trustedProxySetting?.trim());
  const proxyIsTrusted =
    trustProxy &&
    (!hasTrustedProxyList ||
      (trustedProxyIps.length > 0 &&
        direct !== undefined &&
        trustedProxyIps.includes(direct)));
  if (proxyIsTrusted) {
    const forwarded = firstForwardedIp(
      request?.headers['x-forwarded-for'] ??
        request?.headers['X-Forwarded-For'],
    );
    const realIp = normalizeIp(
      headerString(
        request?.headers['x-real-ip'] ?? request?.headers['X-Real-IP'],
      ),
    );
    const client = forwarded ?? realIp;
    if (client) return `ip:${client}`;
  }
  return direct ? `ip:${direct}` : UNKNOWN_SOURCE;
}

export function resolvePolicy(
  overrides?: WebSocketAdmissionPolicyOverrides,
): WebSocketAdmissionPolicy {
  const values = { ...DEFAULT_POLICY, ...overrides };
  return {
    maxActiveSockets: positive(values.maxActiveSockets),
    maxActiveSocketsPerSource: positive(values.maxActiveSocketsPerSource),
    maxUnauthenticatedSockets: positive(values.maxUnauthenticatedSockets),
    maxUnauthenticatedPerSource: positive(values.maxUnauthenticatedPerSource),
    attemptWindowMs: positive(values.attemptWindowMs),
    maxCreateAttemptsPerSource: positive(values.maxCreateAttemptsPerSource),
    maxJoinAttemptsPerSource: positive(values.maxJoinAttemptsPerSource),
    maxResumeAttemptsPerSource: positive(values.maxResumeAttemptsPerSource),
    maxPasswordAttemptsPerSource: positive(values.maxPasswordAttemptsPerSource),
    globalCreateLimit: positive(values.globalCreateLimit),
    globalCreateWindowMs: positive(values.globalCreateWindowMs),
    createCircuitCooldownMs: positive(values.createCircuitCooldownMs),
    broadcastBudget: positive(values.broadcastBudget),
    broadcastWindowMs: positive(values.broadcastWindowMs),
    broadcastCircuitCooldownMs: positive(values.broadcastCircuitCooldownMs),
  };
}

export function loadWebSocketAdmissionPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): WebSocketAdmissionPolicy {
  return resolvePolicy({
    maxActiveSockets: envNumber(
      environment.WS_MAX_ACTIVE_SOCKETS,
      DEFAULT_POLICY.maxActiveSockets,
    ),
    maxActiveSocketsPerSource: envNumber(
      environment.WS_MAX_ACTIVE_SOCKETS_PER_SOURCE,
      DEFAULT_POLICY.maxActiveSocketsPerSource,
    ),
    maxUnauthenticatedSockets: envNumber(
      environment.WS_MAX_UNAUTHENTICATED_SOCKETS,
      DEFAULT_POLICY.maxUnauthenticatedSockets,
    ),
    maxUnauthenticatedPerSource: envNumber(
      environment.WS_MAX_UNAUTHENTICATED_PER_SOURCE,
      DEFAULT_POLICY.maxUnauthenticatedPerSource,
    ),
    attemptWindowMs: envNumber(
      environment.WS_ADMISSION_WINDOW_MS,
      DEFAULT_POLICY.attemptWindowMs,
    ),
    maxCreateAttemptsPerSource: envNumber(
      environment.WS_CREATE_ATTEMPTS_PER_SOURCE,
      DEFAULT_POLICY.maxCreateAttemptsPerSource,
    ),
    maxJoinAttemptsPerSource: envNumber(
      environment.WS_JOIN_ATTEMPTS_PER_SOURCE,
      DEFAULT_POLICY.maxJoinAttemptsPerSource,
    ),
    maxResumeAttemptsPerSource: envNumber(
      environment.WS_RESUME_ATTEMPTS_PER_SOURCE,
      DEFAULT_POLICY.maxResumeAttemptsPerSource,
    ),
    maxPasswordAttemptsPerSource: envNumber(
      environment.WS_PASSWORD_ATTEMPTS_PER_SOURCE,
      DEFAULT_POLICY.maxPasswordAttemptsPerSource,
    ),
    globalCreateLimit: envNumber(
      environment.WS_GLOBAL_CREATE_LIMIT,
      DEFAULT_POLICY.globalCreateLimit,
    ),
    globalCreateWindowMs: envNumber(
      environment.WS_GLOBAL_CREATE_WINDOW_MS,
      DEFAULT_POLICY.globalCreateWindowMs,
    ),
    createCircuitCooldownMs: envNumber(
      environment.WS_CREATE_CIRCUIT_COOLDOWN_MS,
      DEFAULT_POLICY.createCircuitCooldownMs,
    ),
    broadcastBudget: envNumber(
      environment.WS_BROADCAST_BUDGET,
      DEFAULT_POLICY.broadcastBudget,
    ),
    broadcastWindowMs: envNumber(
      environment.WS_BROADCAST_WINDOW_MS,
      DEFAULT_POLICY.broadcastWindowMs,
    ),
    broadcastCircuitCooldownMs: envNumber(
      environment.WS_BROADCAST_CIRCUIT_COOLDOWN_MS,
      DEFAULT_POLICY.broadcastCircuitCooldownMs,
    ),
  });
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeSourceKey(source: string): string {
  return source.length > 80 ? UNKNOWN_SOURCE : source || UNKNOWN_SOURCE;
}

function parseIpList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((candidate) => normalizeIp(candidate))
    .filter((candidate): candidate is string => candidate !== undefined);
}

function firstForwardedIp(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== 'string') return;
  return normalizeIp(value.split(',')[0]);
}

function headerString(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return;
  let candidate = value.trim().toLowerCase();
  if (candidate.startsWith('[') && candidate.endsWith(']'))
    candidate = candidate.slice(1, -1);
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4)
    candidate = candidate.slice(7);
  if (isIP(candidate) === 0) return;
  return candidate;
}

function socketRemoteAddress(socket?: WebSocket): string | undefined {
  const candidate = socket as
    | (WebSocket & { _socket?: { remoteAddress?: string } })
    | undefined;
  return candidate?._socket?.remoteAddress;
}
