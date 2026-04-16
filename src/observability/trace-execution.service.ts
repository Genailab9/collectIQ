import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { WebhookEventEntity } from '../adapters/telephony/webhooks/entities/webhook-event.entity';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import type {
  ExecutionAdapterCallTraceDto,
  ExecutionErrorTraceDto,
  ExecutionTraceDto,
  ExecutionTraceSummaryDto,
  ExecutionTransitionTraceDto,
  ExecutionWebhookTraceDto,
} from './trace-execution.dto';
import { PrometheusMetricsService } from './prometheus-metrics.service';

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { parseError: true, rawSnippet: raw.slice(0, 500) };
  }
}

/**
 * PRD §12 — assemble transition history, adapter audit rows, and idempotency failures for an execution.
 */
@Injectable()
export class TraceExecutionService implements OnModuleDestroy {
  private readonly redis?: Redis;
  private readonly summaryCacheTtlSeconds: number;

  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    @InjectRepository(IdempotencyKeyEntity)
    private readonly idempotencyRows: Repository<IdempotencyKeyEntity>,
    @InjectRepository(WebhookEventEntity)
    private readonly webhookEvents: Repository<WebhookEventEntity>,
    private readonly cipher: AtRestCipherService,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    this.summaryCacheTtlSeconds = Number.parseInt(
      this.config.get<string>('COLLECTIQ_TRACE_SUMMARY_CACHE_TTL_SECONDS') ?? '',
      10,
    );
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
    }
  }

  private cacheKey(tenantId: string, correlationId: string): string {
    return `collectiq:trace:summary:${tenantId.trim()}:${correlationId.trim()}`;
  }

  async evictSummaryCache(tenantId: string, correlationId: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    await this.redis.del(this.cacheKey(tenantId, correlationId));
  }

  onModuleDestroy(): void {
    void this.redis?.quit();
  }

  /**
   * Backward-compatible full trace entrypoint for existing internal callers.
   * New HTTP path should use explicit summary/full methods.
   */
  async traceExecution(tenantId: string, correlationId: string): Promise<ExecutionTraceDto> {
    return this.traceExecutionFull(tenantId, correlationId);
  }

  async traceExecutionFull(tenantId: string, correlationId: string): Promise<ExecutionTraceDto> {
    const t = tenantId.trim();
    const c = correlationId.trim();

    const transitionRows = await this.transitions.find({
      where: { tenantId: t, correlationId: c },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });

    const transitions: ExecutionTransitionTraceDto[] = transitionRows.map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      machine: row.machine,
      from: row.fromState,
      to: row.toState,
      actor: row.actor,
      metadataJson: row.metadataJson,
    }));

    const auditRows = await this.audits.find({
      where: { tenantId: t, correlationId: c },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const adapterCalls: ExecutionAdapterCallTraceDto[] = [];
    const errors: ExecutionErrorTraceDto[] = [];

    for (const row of auditRows) {
      const plaintext = this.cipher.openPayloadJson(row.payloadJson);
      const payload = safeJsonParse(plaintext);
      adapterCalls.push({
        createdAt: row.createdAt.toISOString(),
        auditKind: row.kind,
        executionPhase: row.executionPhase,
        payload,
      });
      if (
        (row.kind === SMEK_ORCHESTRATION_AUDIT_KIND.AdapterResult ||
          row.kind === SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError) &&
        payload &&
        typeof payload === 'object'
      ) {
        const ar = (payload as { adapterResult?: { error?: string; reason?: string } }).adapterResult;
        const lifecycleError =
          row.kind === SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError
            ? (payload as { error?: string }).error
            : undefined;
        const msg =
          lifecycleError ??
          (ar && typeof ar === 'object' ? ar.error ?? ar.reason : undefined);
        if (typeof msg === 'string' && msg.trim()) {
          errors.push({
            source: 'smek_orchestration_audit',
            at: row.createdAt.toISOString(),
            detail: `${row.executionPhase}: ${msg.trim()}`,
          });
        }
      }
    }

    const failedIdem = await this.idempotencyRows.find({
      where: { tenantId: t, correlationId: c, status: 'failed' },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });

    for (const row of failedIdem) {
      errors.push({
        source: 'idempotency_keys',
        at: row.updatedAt.toISOString(),
        detail: `step=${row.step} idempotencyKey=${row.idempotencyKey}`,
      });
    }

    const webhookRows = await this.webhookEvents.find({
      where: { tenantId: t, correlationId: c },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const webhookEvents: ExecutionWebhookTraceDto[] = [];
    for (const row of webhookRows) {
      const rawPayload = safeJsonParse(row.rawPayload);
      const normalizedEvent = row.normalizedEvent ? safeJsonParse(row.normalizedEvent) : null;
      webhookEvents.push({
        createdAt: row.createdAt.toISOString(),
        provider: row.provider,
        stage: 'WEBHOOK_RECEIVED',
        externalDedupeKey: row.externalDedupeKey,
        processed: row.processed,
        rawPayload,
        normalizedEvent,
      });
      if (row.processed) {
        webhookEvents.push({
          createdAt: row.createdAt.toISOString(),
          provider: row.provider,
          stage: 'WEBHOOK_PROCESSED',
          externalDedupeKey: row.externalDedupeKey,
          processed: row.processed,
          rawPayload,
          normalizedEvent,
        });
      }
    }

    return {
      mode: 'full',
      traceId: c,
      tenantId: t,
      correlationId: c,
      transitions,
      adapterCalls,
      webhookEvents,
      errors,
    };
  }

  async traceExecutionSummary(tenantId: string, correlationId: string): Promise<ExecutionTraceSummaryDto> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const cacheKey = this.cacheKey(t, c);
    if (this.redis) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as ExecutionTraceSummaryDto;
          this.metrics?.incTraceSummaryCacheHit();
          return parsed;
        } catch {
          // fall through
        }
      }
      this.metrics?.incTraceSummaryCacheMiss();
    }
    const transitionRows = await this.transitions.find({
      where: { tenantId: t, correlationId: c },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
    const transitions: ExecutionTransitionTraceDto[] = transitionRows.map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      machine: row.machine,
      from: row.fromState,
      to: row.toState,
      actor: row.actor,
      metadataJson: null,
    }));
    const currentStateByMachine: Record<string, string> = {};
    for (const row of transitionRows) {
      currentStateByMachine[row.machine] = row.toState;
    }

    const adapterErrorRows = await this.audits.count({
      where: {
        tenantId: t,
        correlationId: c,
        kind: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError,
      },
    });
    const failedIdem = await this.idempotencyRows.find({
      where: { tenantId: t, correlationId: c, status: 'failed' },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
    const webhookRows = await this.webhookEvents.find({
      where: { tenantId: t, correlationId: c },
      select: { createdAt: true, processed: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const errors: ExecutionErrorTraceDto[] = [];
    for (const row of failedIdem) {
      errors.push({
        source: 'idempotency_keys',
        at: row.updatedAt.toISOString(),
        detail: `step=${row.step} idempotencyKey=${row.idempotencyKey}`,
      });
    }
    if (adapterErrorRows > 0) {
      const at = transitionRows[transitionRows.length - 1]?.occurredAt?.toISOString() ?? new Date().toISOString();
      errors.push({
        source: 'smek_orchestration_audit',
        at,
        detail: `adapter_error_count=${adapterErrorRows}`,
      });
    }

    const summary: ExecutionTraceSummaryDto = {
      mode: 'summary',
      traceId: c,
      tenantId: t,
      correlationId: c,
      transitions,
      currentStateByMachine,
      startedAt: transitionRows[0]?.occurredAt.toISOString() ?? null,
      lastTransitionAt: transitionRows[transitionRows.length - 1]?.occurredAt.toISOString() ?? null,
      metrics: {
        transitionCount: transitionRows.length,
        adapterErrorCount: adapterErrorRows,
        idempotencyFailureCount: failedIdem.length,
        webhookReceivedCount: webhookRows.length,
        webhookProcessedCount: webhookRows.filter((x) => x.processed).length,
      },
      errors,
    };
    if (this.redis) {
      const ttl =
        Number.isFinite(this.summaryCacheTtlSeconds) && this.summaryCacheTtlSeconds > 0
          ? this.summaryCacheTtlSeconds
          : 8;
      await this.redis.set(cacheKey, JSON.stringify(summary), 'EX', ttl);
    }
    return summary;
  }
}
