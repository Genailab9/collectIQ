import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { StructuredLogEvent } from './structured-log.types';
import { PrometheusMetricsService } from './prometheus-metrics.service';

const RING_MAX = 2000;
const MAX_MESSAGE_CHARS = 2048;
const SENSITIVE_MESSAGE_PATTERN = /(password|api[_-]?key|authorization:\s*bearer\s+\S+)/gi;
const REDIS_LOG_KEY_PREFIX = 'collectiq:logs:';
const DEFAULT_REDIS_MAX = 3000;
const DEFAULT_REDIS_TTL_SECONDS = 60 * 60 * 24 * 2;
const DEFAULT_LOGS_MAX_PER_SECOND = 100;

export function sanitizeStructuredLogMessage(raw: string): string {
  const redacted = raw.replace(SENSITIVE_MESSAGE_PATTERN, '[REDACTED]');
  if (redacted.length <= MAX_MESSAGE_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_MESSAGE_CHARS)}…[truncated]`;
}

function snapshotForRing(event: StructuredLogEvent): StructuredLogEvent {
  if (event.message === undefined) {
    return { ...event };
  }
  return {
    ...event,
    message: sanitizeStructuredLogMessage(String(event.message)),
  };
}

/**
 * PRD §12 — JSON-per-line structured logging for operations and compliance review.
 */
@Injectable()
export class StructuredLoggerService implements OnModuleDestroy {
  private readonly nest = new Logger(StructuredLoggerService.name);
  private readonly ring = new Map<string, StructuredLogEvent[]>();
  private readonly redis?: Redis;
  private readonly redisMaxEntries: number;
  private readonly redisTtlSeconds: number;
  private readonly logsMaxPerSecond: number;
  private warnedMemoryFallback = false;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    this.redisMaxEntries = Number.parseInt(
      this.config.get<string>('COLLECTIQ_LOGS_REDIS_MAX_ENTRIES') ?? '',
      10,
    );
    this.redisTtlSeconds = Number.parseInt(
      this.config.get<string>('COLLECTIQ_LOGS_REDIS_TTL_SECONDS') ?? '',
      10,
    );
    this.logsMaxPerSecond = Number.parseInt(
      this.config.get<string>('COLLECTIQ_LOGS_MAX_PER_SECOND') ?? '',
      10,
    );
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      this.redis.on('error', (e) => this.nest.warn(`structured.redis ${e.message}`));
    }
  }

  onModuleDestroy(): void {
    void this.redis?.quit();
  }

  emit(event: StructuredLogEvent): void {
    const safe = snapshotForRing(event);
    const timestamp = new Date().toISOString();
    const line: Record<string, unknown> = {
      level: safe.level ?? 'info',
      timestamp,
      correlationId: event.correlationId,
      tenantId: event.tenantId,
      phase: event.phase,
      state: event.state,
      adapter: event.adapter,
      result: event.result,
    };
    if (safe.surface !== undefined) {
      line.surface = safe.surface;
    }
    if (safe.message !== undefined) {
      line.message = safe.message;
    }
    if (safe.attempt !== undefined) {
      line.attempt = safe.attempt;
    }
    if (safe.maxAttempts !== undefined) {
      line.maxAttempts = safe.maxAttempts;
    }
    if (safe.circuitKey !== undefined) {
      line.circuitKey = safe.circuitKey;
    }
    this.nest.log(JSON.stringify(line));
    if (this.redis) {
      const tenant = safe.tenantId.trim() || 'unknown';
      const key = `${REDIS_LOG_KEY_PREFIX}${tenant}`;
      const max = Number.isFinite(this.redisMaxEntries) && this.redisMaxEntries > 0 ? this.redisMaxEntries : DEFAULT_REDIS_MAX;
      const ttl = Number.isFinite(this.redisTtlSeconds) && this.redisTtlSeconds > 0 ? this.redisTtlSeconds : DEFAULT_REDIS_TTL_SECONDS;
      const rateMax =
        Number.isFinite(this.logsMaxPerSecond) && this.logsMaxPerSecond > 0
          ? this.logsMaxPerSecond
          : DEFAULT_LOGS_MAX_PER_SECOND;
      const secondBucket = Math.floor(Date.now() / 1000);
      const rateKey = `collectiq:logs:rate:${tenant}:${secondBucket}`;
      void (async () => {
        try {
          const count = await this.redis!.incr(rateKey);
          if (count === 1) {
            await this.redis!.expire(rateKey, 2);
          }
          if (count > rateMax) {
            this.metrics?.incLogsDropped(tenant);
            return;
          }
          await this.redis!
            .multi()
            .lpush(key, JSON.stringify({ ...safe, timestamp, at: timestamp, level: safe.level ?? 'info' }))
            .ltrim(key, 0, max - 1)
            .expire(key, ttl)
            .exec();
          this.metrics?.incLogsWritten(tenant);
        } catch (e) {
          this.nest.warn(`structured.redis_write ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
      return;
    }
    if (!this.warnedMemoryFallback) {
      this.nest.warn('Structured logger: REDIS_URL unset, using in-memory tenant ring.');
      this.warnedMemoryFallback = true;
    }
    const tenant = safe.tenantId.trim() || 'unknown';
    const bucket = this.ring.get(tenant) ?? [];
    bucket.push({ ...safe, timestamp, at: timestamp, level: safe.level ?? 'info' });
    if (bucket.length > RING_MAX) bucket.splice(0, bucket.length - RING_MAX);
    this.ring.set(tenant, bucket);
    this.metrics?.incLogsWritten(tenant);
  }

  /** Bounded export for incident response, scoped per tenant. */
  exportRecentStructured(tenantId: string, limit = 500, correlationId?: string): StructuredLogEvent[] {
    const n = Math.min(RING_MAX, Math.max(1, limit));
    const t = tenantId.trim();
    if (this.redis) {
      this.nest.warn('Structured logger: use async export path for Redis-backed logs.');
      return [];
    }
    const rows = (this.ring.get(t) ?? []).slice(-n);
    if (!correlationId?.trim()) return rows;
    const c = correlationId.trim();
    return rows.filter((x) => x.correlationId === c);
  }

  async exportRecentStructuredAsync(
    tenantId: string,
    limit = 500,
    correlationId?: string,
  ): Promise<StructuredLogEvent[]> {
    const t = tenantId.trim();
    const n = Math.min(5000, Math.max(1, limit));
    if (!this.redis) {
      return this.exportRecentStructured(t, n, correlationId);
    }
    const key = `${REDIS_LOG_KEY_PREFIX}${t}`;
    const raw = await this.redis.lrange(key, 0, n - 1);
    const out: StructuredLogEvent[] = [];
    for (const item of raw.reverse()) {
      try {
        const parsed = JSON.parse(item) as StructuredLogEvent;
        out.push(parsed);
      } catch {
        // ignore malformed rows
      }
    }
    if (!correlationId?.trim()) return out;
    const c = correlationId.trim();
    return out.filter((x) => x.correlationId === c);
  }
}
