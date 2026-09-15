import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

export type MetricLabels = Record<string, string>;
export type MetricSnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
};

type MetricListener = (
  name: string,
  value: number,
  labels: MetricLabels,
) => void;

const SAFE_METRIC_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
const SAFE_LABEL = /^[a-z][a-z0-9_.-]{0,31}$/;
const SAFE_LABEL_KEYS = new Set(['namespace', 'operation', 'reason', 'status']);
const MAX_METRICS = 256;
const MAX_LOG_KEYS = 64;
const LOG_SAMPLE_INTERVAL_MS = 1_000;

/**
 * Small, dependency-free telemetry adapter for transport admission decisions.
 *
 * Values are deliberately process-local. Deployments can subscribe a bounded
 * exporter later without making gateways depend on a metrics vendor. Labels
 * are restricted to low-cardinality operational values so a room code, note,
 * cookie, credential, IP address, or other request data cannot become a
 * metric/log field by accident.
 */
@Injectable()
export class TransportMetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(TransportMetricsService.name);
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly listeners = new Set<MetricListener>();
  private readonly lastLogAt = new Map<string, number>();

  increment(name: string, labels: MetricLabels = {}): void {
    const safeLabels = this.safeLabels(labels);
    const metric = this.metricKey(name, safeLabels);
    if (!metric) return;
    const next = (this.counters.get(metric) ?? 0) + 1;
    this.counters.set(metric, next);
    this.notify(name, next, safeLabels);
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const safeLabels = this.safeLabels(labels);
    const metric = this.metricKey(name, safeLabels);
    if (!metric || !Number.isFinite(value)) return;
    const normalized = Math.max(0, Math.floor(value));
    this.gauges.set(metric, normalized);
    this.notify(name, normalized, safeLabels);
  }

  onMetric(listener: MetricListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  counter(name: string, labels: MetricLabels = {}): number {
    const metric = this.metricKey(name, labels);
    return metric ? (this.counters.get(metric) ?? 0) : 0;
  }

  gauge(name: string, labels: MetricLabels = {}): number {
    const metric = this.metricKey(name, labels);
    return metric ? (this.gauges.get(metric) ?? 0) : 0;
  }

  snapshot(): MetricSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  recordConnectionRejected(namespace: string, reason: string): void {
    this.increment('websocket.connections.rejected', {
      namespace: this.safeLabel(namespace),
      reason: this.safeLabel(reason),
    });
    this.logOnce(
      `connection:${namespace}:${reason}`,
      `websocket admission rejected namespace=${this.safeLabel(namespace)} reason=${this.safeLabel(reason)}`,
    );
  }

  recordOperationThrottled(namespace: string, operation: string): void {
    this.increment('websocket.operations.throttled', {
      namespace: this.safeLabel(namespace),
      operation: this.safeLabel(operation),
    });
    this.logOnce(
      `operation:${namespace}:${operation}`,
      `websocket operation throttled namespace=${this.safeLabel(namespace)} operation=${this.safeLabel(operation)}`,
    );
  }

  recordCapacityExhausted(namespace: string, operation: string): void {
    this.increment('websocket.capacity.exhausted', {
      namespace: this.safeLabel(namespace),
      operation: this.safeLabel(operation),
    });
  }

  recordBroadcastThrottled(namespace: string): void {
    this.increment('websocket.broadcasts.throttled', {
      namespace: this.safeLabel(namespace),
    });
    this.logOnce(
      `broadcast:${namespace}`,
      `websocket broadcast pressure namespace=${this.safeLabel(namespace)}`,
    );
  }

  onModuleDestroy(): void {
    this.listeners.clear();
    this.lastLogAt.clear();
    this.counters.clear();
    this.gauges.clear();
  }

  private metricKey(name: string, labels: MetricLabels): string | undefined {
    if (!SAFE_METRIC_NAME.test(name)) return;
    if (this.counters.size + this.gauges.size >= MAX_METRICS) {
      const existing = [...this.counters.keys(), ...this.gauges.keys()].some(
        (key) => key === name || key.startsWith(`${name}|`),
      );
      if (!existing) return;
    }
    const entries = Object.entries(labels)
      .filter(
        ([key, value]) =>
          SAFE_LABEL_KEYS.has(key) &&
          SAFE_LABEL.test(key) &&
          typeof value === 'string' &&
          SAFE_LABEL.test(value) &&
          value !== 'unknown',
      )
      .sort(([left], [right]) => left.localeCompare(right));
    return entries.length
      ? `${name}|${entries.map(([key, value]) => `${key}=${value}`).join(',')}`
      : name;
  }

  private safeLabels(labels: MetricLabels): MetricLabels {
    return Object.fromEntries(
      Object.entries(labels).flatMap(([key, value]) =>
        SAFE_LABEL_KEYS.has(key) &&
        typeof value === 'string' &&
        SAFE_LABEL.test(value)
          ? [[key, value]]
          : [],
      ),
    );
  }

  private safeLabel(value: string): string {
    return SAFE_LABEL.test(value) ? value : 'unknown';
  }

  private notify(name: string, value: number, labels: MetricLabels): void {
    for (const listener of this.listeners) listener(name, value, labels);
  }

  private logOnce(key: string, message: string): void {
    const now = Date.now();
    const last = this.lastLogAt.get(key);
    if (last !== undefined && now - last < LOG_SAMPLE_INTERVAL_MS) return;
    if (last === undefined && this.lastLogAt.size >= MAX_LOG_KEYS)
      this.lastLogAt.delete(this.lastLogAt.keys().next().value as string);
    this.lastLogAt.set(key, now);
    this.logger.warn(message);
  }
}
