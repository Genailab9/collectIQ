import { Injectable } from '@nestjs/common';

type LabelMap = Record<string, string>;

interface SeriesKey {
  readonly name: string;
  readonly labels: LabelMap;
}

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

  private incCounter(name: string, labels: LabelMap, delta = 1): void {
    const key = seriesKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
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

    const orderedNames = [...byName.keys()].sort();
    for (const name of orderedNames) {
      const help = HELP_TEXT[name];
      if (help) {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} counter`);
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
};
