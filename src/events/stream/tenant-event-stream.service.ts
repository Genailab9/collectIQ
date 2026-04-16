import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MessageEvent } from '@nestjs/common';
import Redis from 'ioredis';
import { TraceExecutionService } from '../../observability/trace-execution.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';

export type StreamDomainEventName =
  | 'PAYMENT_PROCESSED'
  | 'SETTLEMENT_ACCEPTED'
  | 'ACCOUNT_CLOSED'
  | string;

export type TenantStreamPayload =
  | {
      readonly schemaVersion?: string;
      readonly occurredAt?: string;
      readonly envelope: 'DOMAIN_EVENT';
      readonly tenantId: string;
      readonly correlationId: string;
      readonly eventType: StreamDomainEventName;
      readonly payload: unknown;
    }
  | {
      readonly schemaVersion?: string;
      readonly occurredAt?: string;
      readonly envelope: 'STATE_TRANSITION';
      readonly tenantId: string;
      readonly correlationId: string;
      readonly machine: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly schemaVersion?: string;
      readonly occurredAt?: string;
      readonly envelope: 'WEBHOOK_EVENT';
      readonly tenantId: string;
      readonly correlationId: string;
      readonly provider: string;
      readonly kind: string;
      readonly outcome: string;
      readonly detail?: Record<string, unknown>;
    };

type Listener = (payload: TenantStreamPayload) => void;

export const MAX_SSE_LISTENERS_PER_TENANT = 100;
export const EXECUTION_STREAM_SCHEMA_VERSION = '1.0.0';

/**
 * Cross-process fanout when `REDIS_URL` is set (Redis Pub/Sub); otherwise in-memory (single instance).
 */
@Injectable()
export class TenantEventStreamService implements OnModuleDestroy {
  private withSchemaVersion(payload: TenantStreamPayload): TenantStreamPayload {
    if (payload.schemaVersion && payload.schemaVersion.trim().length > 0) {
      return payload;
    }
    return { ...payload, schemaVersion: EXECUTION_STREAM_SCHEMA_VERSION };
  }

  private readonly logger = new Logger(TenantEventStreamService.name);
  private readonly memoryListeners = new Map<string, Set<Listener>>();
  private readonly redisListenerCounts = new Map<string, number>();
  private readonly publisher?: Redis;
  private readonly redisUrl: string | undefined;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly traces?: TraceExecutionService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    this.redisUrl = url && url.length > 0 ? url : undefined;
    if (this.redisUrl) {
      this.publisher = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
      });
      this.publisher.on('error', (e) => this.logger.error(`redis_pub ${e.message}`));
      this.logger.log('Event stream: Redis Pub/Sub enabled.');
    } else {
      this.logger.warn('Event stream: REDIS_URL unset — using in-memory bus (single-instance only).');
    }
  }

  onModuleDestroy(): void {
    void this.publisher?.quit();
  }

  subscribe(tenantId: string, listener: Listener): () => void {
    const t = tenantId.trim();
    if (!t) {
      return () => undefined;
    }

    if (this.publisher && this.redisUrl) {
      const n = this.redisListenerCounts.get(t) ?? 0;
      if (n >= MAX_SSE_LISTENERS_PER_TENANT) {
        this.logger.warn(`stream.max_listeners tenant=${t}`);
        this.metrics?.incSseListenerRejected('redis');
        return () => undefined;
      }
      const channel = `collectiq:stream:${t}`;
      const sub = new Redis(this.redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      sub.on('error', (e) => this.logger.warn(`redis_sub ${e.message}`));
      void sub.subscribe(channel).catch((err) => {
        this.logger.warn(`redis_subscribe ${err instanceof Error ? err.message : String(err)}`);
      });
      const onMessage = (_ch: string, msg: string): void => {
        try {
          const payload = JSON.parse(msg) as TenantStreamPayload;
          listener(payload);
        } catch {
          // ignore malformed
        }
      };
      sub.on('message', onMessage);
      this.redisListenerCounts.set(t, n + 1);
      this.metrics?.setSseListeners(t, n + 1);
      return () => {
        void sub.unsubscribe(channel);
        void sub.quit();
        const c = (this.redisListenerCounts.get(t) ?? 1) - 1;
        if (c <= 0) {
          this.redisListenerCounts.delete(t);
          this.metrics?.setSseListeners(t, 0);
        } else {
          this.redisListenerCounts.set(t, c);
          this.metrics?.setSseListeners(t, c);
        }
      };
    }

    let set = this.memoryListeners.get(t);
    if (!set) {
      set = new Set();
      this.memoryListeners.set(t, set);
    }
    if (set.size >= MAX_SSE_LISTENERS_PER_TENANT) {
      this.logger.warn(`stream.max_listeners_memory tenant=${t}`);
      this.metrics?.incSseListenerRejected('memory');
      return () => undefined;
    }
    set.add(listener);
    this.metrics?.setSseListeners(t, set.size);
    return () => {
      const bucket = this.memoryListeners.get(t);
      if (!bucket) {
        return;
      }
      bucket.delete(listener);
      if (bucket.size === 0) {
        this.memoryListeners.delete(t);
        this.metrics?.setSseListeners(t, 0);
      } else {
        this.metrics?.setSseListeners(t, bucket.size);
      }
    };
  }

  emit(payload: TenantStreamPayload): void {
    const versionedPayload = this.withSchemaVersion(payload);
    const t = versionedPayload.tenantId.trim();
    if (!t) {
      return;
    }
    if (
      versionedPayload.envelope === 'STATE_TRANSITION' ||
      versionedPayload.envelope === 'DOMAIN_EVENT' ||
      versionedPayload.envelope === 'WEBHOOK_EVENT'
    ) {
      this.metrics?.incSseEventsPublished(versionedPayload.envelope);
      const listenerCount =
        (this.publisher ? this.redisListenerCounts.get(t) : this.memoryListeners.get(t)?.size) ?? 0;
      this.metrics?.setSseFanoutLoad(t, versionedPayload.envelope, listenerCount);
      void this.traces?.evictSummaryCache(versionedPayload.tenantId, versionedPayload.correlationId);
    }
    if (this.publisher) {
      const channel = `collectiq:stream:${t}`;
      void this.publisher.publish(channel, JSON.stringify(versionedPayload)).catch((e) =>
        this.logger.warn(`redis_publish ${e instanceof Error ? e.message : String(e)}`),
      );
      return;
    }
    const bucket = this.memoryListeners.get(t);
    if (!bucket?.size) {
      return;
    }
    for (const fn of bucket) {
      try {
        fn(versionedPayload);
      } catch (err) {
        this.logger.warn(`stream.listener_error ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  toMessageEvent(payload: TenantStreamPayload): MessageEvent {
    return { type: 'message', data: JSON.stringify(this.withSchemaVersion(payload)) } as MessageEvent;
  }
}
