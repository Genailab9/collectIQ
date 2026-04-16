import { Injectable } from '@nestjs/common';

type LabelMap = Record<string, string>;

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: LabelMap): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return '';
  }
  return `{${keys.map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`).join(',')}}`;
}

function seriesKey(name: string, labels: LabelMap): string {
  return `${name}|${formatLabels(labels)}`;
}

/**
 * In-process counters for Prometheus text exposition (single-process; suitable for sidecar scrape or dev).
 */
@Injectable()
export class PrometheusMetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  private incCounter(name: string, labels: LabelMap, delta = 1): void {
    const key = seriesKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
  }

  private setGauge(name: string, labels: LabelMap, value: number): void {
    const key = seriesKey(name, labels);
    this.gauges.set(key, value);
  }

  incExecutionsStarted(phase: string): void {
    this.incCounter('collectiq_executions_started_total', { phase: phase || 'unknown' });
  }

  incExecutionsCompleted(phase: string): void {
    this.incCounter('collectiq_executions_completed_total', { phase: phase || 'unknown' });
  }

  incExecutionsFailed(reason: 'exception' | 'compliance'): void {
    this.incCounter('collectiq_executions_failed_total', { reason });
  }

  incRetries(operation: string): void {
    this.incCounter('collectiq_retries_count_total', { operation: operation || 'unknown' });
  }

  /** Circuit transitioned to OPEN (failure threshold reached). */
  incCircuitBreakerTripped(): void {
    this.incCounter('collectiq_circuit_breaker_open_total', { event: 'trip' });
  }

  /** Call rejected because the circuit was already OPEN. */
  incCircuitBreakerRejected(): void {
    this.incCounter('collectiq_circuit_breaker_open_total', { event: 'reject' });
  }

  incPaymentFailures(step: string): void {
    this.incCounter('collectiq_payment_failures_total', { step: step || 'unknown' });
  }

  incWebhookUnmapped(reason: string): void {
    this.incCounter('collectiq_webhook_unmapped_total', { reason: reason || 'unknown' });
  }

  incIngestionRateLimited(): void {
    this.incCounter('collectiq_ingestion_rate_limited_total', { surface: 'upload' });
  }

  incLogsWritten(tenantId: string): void {
    this.incCounter('collectiq_logs_written_total', { tenantId: tenantId || 'unknown' });
  }

  incLogsDropped(tenantId: string): void {
    this.incCounter('collectiq_logs_dropped_total', { tenantId: tenantId || 'unknown' });
  }

  incSseEventsPublished(envelope: 'STATE_TRANSITION' | 'DOMAIN_EVENT' | 'WEBHOOK_EVENT'): void {
    this.incCounter('collectiq_sse_events_published_total', { envelope });
  }

  incSseListenerRejected(mode: 'redis' | 'memory'): void {
    this.incCounter('collectiq_sse_listener_rejected_total', { mode });
  }

  setSseListeners(tenantId: string, count: number): void {
    this.setGauge('collectiq_sse_listeners', { tenantId: tenantId || 'unknown' }, Math.max(0, count));
  }

  setSseFanoutLoad(tenantId: string, envelope: string, listeners: number): void {
    this.setGauge(
      'collectiq_sse_fanout_load',
      { tenantId: tenantId || 'unknown', envelope: envelope || 'unknown' },
      Math.max(0, listeners),
    );
  }

  incTraceSummaryRequest(): void {
    this.incCounter('collectiq_trace_summary_requests_total', {});
  }

  incTraceFullRequest(): void {
    this.incCounter('collectiq_trace_full_requests_total', {});
  }

  incTraceSummaryCacheHit(): void {
    this.incCounter('collectiq_trace_summary_cache_hits_total', {});
  }

  incTraceSummaryCacheMiss(): void {
    this.incCounter('collectiq_trace_summary_cache_miss_total', {});
  }

  incApiRequestsTotal(surface: string, operation: string): void {
    this.incCounter('collectiq_api_requests_total', {
      surface: surface || 'unknown',
      operation: operation || 'unknown',
    });
  }

  incApiErrorsTotal(surface: string, operation: string, reason: string): void {
    this.incCounter('collectiq_api_errors_total', {
      surface: surface || 'unknown',
      operation: operation || 'unknown',
      reason: reason || 'unknown',
    });
  }

  incWorkerRunsTotal(worker: string, operation: string): void {
    this.incCounter('collectiq_worker_runs_total', {
      worker: worker || 'unknown',
      operation: operation || 'unknown',
    });
  }

  incWorkerErrorsTotal(worker: string, operation: string, reason: string): void {
    this.incCounter('collectiq_worker_errors_total', {
      worker: worker || 'unknown',
      operation: operation || 'unknown',
      reason: reason || 'unknown',
    });
  }

  observeApiLatencyMs(surface: string, operation: string, latencyMs: number): void {
    const l = Math.max(0, Math.floor(latencyMs));
    const bucket = this.latencyBucket(l);
    this.incCounter('collectiq_api_latency_ms_bucket', {
      surface: surface || 'unknown',
      operation: operation || 'unknown',
      le: bucket,
    });
    this.incCounter('collectiq_api_latency_ms_count', { surface: surface || 'unknown', operation: operation || 'unknown' });
    this.incCounter('collectiq_api_latency_ms_sum', { surface: surface || 'unknown', operation: operation || 'unknown' }, l);
  }

  observeWorkerLatencyMs(worker: string, operation: string, latencyMs: number): void {
    const l = Math.max(0, Math.floor(latencyMs));
    const bucket = this.latencyBucket(l);
    this.incCounter('collectiq_worker_latency_ms_bucket', {
      worker: worker || 'unknown',
      operation: operation || 'unknown',
      le: bucket,
    });
    this.incCounter('collectiq_worker_latency_ms_count', { worker: worker || 'unknown', operation: operation || 'unknown' });
    this.incCounter('collectiq_worker_latency_ms_sum', { worker: worker || 'unknown', operation: operation || 'unknown' }, l);
  }

  setSurvivalQueueDepth(queue: string, depth: number): void {
    this.setGauge('collectiq_survival_queue_depth', { queue: queue || 'unknown' }, Math.max(0, depth));
  }

  setWorkerBacklog(worker: string, operation: string, depth: number): void {
    this.setGauge(
      'collectiq_worker_backlog_depth',
      { worker: worker || 'unknown', operation: operation || 'unknown' },
      Math.max(0, depth),
    );
  }

  setProjectionLagMs(value: number): void {
    this.setGauge('collectiq_projection_lag_ms', {}, Math.max(0, Math.floor(value)));
  }

  setProjectionBacklogDepth(value: number): void {
    this.setGauge('collectiq_projection_backlog_depth', {}, Math.max(0, Math.floor(value)));
  }

  incProjectionIntegrityErrors(reason: string): void {
    this.incCounter('collectiq_projection_integrity_errors_total', { reason: reason || 'unknown' });
  }

  incReplayRequests(operation: string): void {
    this.incCounter('collectiq_replay_requests_total', { operation: operation || 'unknown' });
  }

  observeReplayLatencyMs(operation: string, latencyMs: number): void {
    const l = Math.max(0, Math.floor(latencyMs));
    const bucket = this.latencyBucket(l);
    this.incCounter('collectiq_replay_latency_ms_bucket', { operation: operation || 'unknown', le: bucket });
    this.incCounter('collectiq_replay_latency_ms_count', { operation: operation || 'unknown' });
    this.incCounter('collectiq_replay_latency_ms_sum', { operation: operation || 'unknown' }, l);
  }

  incReplayIntegrityFailures(reason: string): void {
    this.incCounter('collectiq_replay_integrity_failures_total', { reason: reason || 'unknown' });
  }

  incChainAnchorWritten(): void {
    this.incCounter('collectiq_chain_anchor_written_total', {});
  }

  private latencyBucket(ms: number): string {
    const bounds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    for (const b of bounds) {
      if (ms <= b) return String(b);
    }
    return '+Inf';
  }

  /** Sum all series values whose metric name matches `name` (including labeled series). */
  getCounterSum(name: string): number {
    let sum = 0;
    for (const [key, value] of this.counters) {
      const pipe = key.indexOf('|');
      const metricName = pipe >= 0 ? key.slice(0, pipe) : key;
      if (metricName === name) {
        sum += value;
      }
    }
    return sum;
  }

  renderPrometheusText(): string {
    const lines: string[] = [];
    const byName = new Map<string, Map<string, number>>();

    for (const [key, value] of this.counters) {
      const pipe = key.indexOf('|');
      const name = pipe >= 0 ? key.slice(0, pipe) : key;
      const labelPart = pipe >= 0 ? key.slice(pipe + 1) : '';
      if (!byName.has(name)) {
        byName.set(name, new Map());
      }
      byName.get(name)!.set(labelPart, value);
    }

    for (const [key, value] of this.gauges) {
      const pipe = key.indexOf('|');
      const name = pipe >= 0 ? key.slice(0, pipe) : key;
      const labelPart = pipe >= 0 ? key.slice(pipe + 1) : '';
      if (!byName.has(name)) {
        byName.set(name, new Map());
      }
      byName.get(name)!.set(labelPart, value);
    }

    const orderedNames = [...byName.keys()].sort();
    for (const name of orderedNames) {
      const help = HELP_TEXT[name];
      if (help) {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${GAUGE_METRICS.has(name) ? 'gauge' : 'counter'}`);
      }
      const series = byName.get(name)!;
      const orderedKeys = [...series.keys()].sort();
      for (const lk of orderedKeys) {
        const suffix = lk.length > 0 ? lk : '';
        lines.push(`${name}${suffix} ${String(series.get(lk) ?? 0)}`);
      }
    }

    return lines.length > 0 ? `${lines.join('\n')}\n` : '# no metrics yet\n';
  }
}

const HELP_TEXT: Record<string, string> = {
  collectiq_executions_started_total: 'SMEK executions started (excludes idempotency replay short-circuits).',
  collectiq_executions_completed_total: 'SMEK executions that completed successfully.',
  collectiq_executions_failed_total: 'SMEK executions that ended in compliance block or uncaught exception.',
  collectiq_retries_count_total: 'Resilience-layer retry attempts scheduled.',
  collectiq_circuit_breaker_open_total: 'Circuit breaker trips and open-circuit rejections.',
  collectiq_payment_failures_total: 'Payment service operational failures (provider/SMEK/reconcile).',
  collectiq_webhook_unmapped_total: 'Provider webhooks acknowledged but not mapped to a state transition.',
  collectiq_ingestion_rate_limited_total: 'Ingestion uploads delayed by tenant ingestion rate limits.',
  collectiq_logs_written_total: 'Structured log entries written to observability storage.',
  collectiq_logs_dropped_total: 'Structured log entries dropped by per-tenant rate protection.',
  collectiq_sse_events_published_total: 'SSE envelope events published by the backend.',
  collectiq_trace_summary_requests_total: 'Trace summary requests served.',
  collectiq_trace_full_requests_total: 'Trace full requests served.',
  collectiq_trace_summary_cache_hits_total: 'Trace summary cache hits.',
  collectiq_trace_summary_cache_miss_total: 'Trace summary cache misses.',
  collectiq_api_requests_total: 'API request total count by surface and operation.',
  collectiq_api_errors_total: 'API request errors by surface, operation, and reason.',
  collectiq_api_latency_ms_bucket: 'API latency histogram bucket samples (ms).',
  collectiq_api_latency_ms_count: 'API latency sample count.',
  collectiq_api_latency_ms_sum: 'API latency total sum (ms).',
  collectiq_worker_runs_total: 'Worker operation run total count.',
  collectiq_worker_errors_total: 'Worker operation failures by reason.',
  collectiq_worker_latency_ms_bucket: 'Worker latency histogram bucket samples (ms).',
  collectiq_worker_latency_ms_count: 'Worker latency sample count.',
  collectiq_worker_latency_ms_sum: 'Worker latency total sum (ms).',
  collectiq_survival_queue_depth: 'Current depth of survival queue status buckets.',
  collectiq_projection_lag_ms: 'Projection lag in milliseconds between now and latest projected event timestamp.',
  collectiq_projection_backlog_depth: 'Projected event count for active incident projection scope.',
  collectiq_projection_integrity_errors_total: 'Projection integrity validation failures by reason.',
  collectiq_replay_requests_total: 'Replay API requests by operation.',
  collectiq_replay_latency_ms_bucket: 'Replay API latency histogram bucket samples (ms).',
  collectiq_replay_latency_ms_count: 'Replay API latency sample count.',
  collectiq_replay_latency_ms_sum: 'Replay API latency total sum (ms).',
  collectiq_replay_integrity_failures_total: 'Replay integrity failures by reason.',
  collectiq_chain_anchor_written_total: 'Chain anchor checkpoints written.',
  collectiq_sse_listeners: 'Current active SSE listeners per tenant.',
  collectiq_sse_listener_rejected_total: 'SSE listener subscribe attempts rejected by caps.',
  collectiq_sse_fanout_load: 'SSE fanout load (listeners reached per tenant and envelope).',
  collectiq_worker_backlog_depth: 'Current worker backlog depth by worker and operation.',
};

const GAUGE_METRICS = new Set([
  'collectiq_survival_queue_depth',
  'collectiq_sse_listeners',
  'collectiq_sse_fanout_load',
  'collectiq_projection_lag_ms',
  'collectiq_projection_backlog_depth',
  'collectiq_worker_backlog_depth',
]);
