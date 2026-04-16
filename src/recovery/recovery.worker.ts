import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { ExecutionRecoveryService } from './execution-recovery.service';
import { WebhookRecoveryService, webhookRecoverySilenceMinutes } from './webhook-recovery.service';
import { emitRuntimeProof } from '../runtime-proof/runtime-proof-emitter';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';

const DEFAULT_TIMEOUT_MINUTES = 5;
/** Caps work per tick so one minute cannot scan an unbounded log. */
const MAX_CANDIDATES_PER_TICK = 200;
const MAX_WEBHOOK_RECOVERY_PER_KIND = 30;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, 24 * 60);
}

export interface StaleExecutionRow {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly lastOccurredAt: Date;
}

/**
 * PRD v1.3 §13 — background sweep of stale, non-terminal executions; resumes only via `ExecutionRecoveryService` → SMEK.
 * Idempotent: SMEK idempotency keys plus per-process in-flight de-duplication for overlapping cron ticks.
 */
@Injectable()
export class RecoveryWorker {
  // LEGACY MIGRATION SURFACE: worker sweep queries still use repository/query-builder while system-plane migration completes.
  private readonly logger = new Logger(RecoveryWorker.name);
  /** Keys `${tenantId}\x1f${correlationId}` currently inside `recoverExecution`. */
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitionLog: Repository<StateTransitionLogEntity>,
    private readonly recovery: ExecutionRecoveryService,
    private readonly webhookRecovery: WebhookRecoveryService,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
    private readonly structured: StructuredLoggerService,
    private readonly metrics: PrometheusMetricsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepStaleExecutions(): Promise<void> {
    const started = Date.now();
    this.metrics.incWorkerRunsTotal('recovery_worker', 'sweep_stale_executions');
    const enabled = (this.config.get<string>('RECOVERY_WORKER_ENABLED', 'true') ?? 'true').toLowerCase();
    if (enabled === 'false' || enabled === '0' || enabled === 'no') {
      this.metrics.observeWorkerLatencyMs('recovery_worker', 'sweep_stale_executions', Date.now() - started);
      return;
    }

    this.structured.emit({
      correlationId: 'n/a',
      tenantId: 'n/a',
      phase: 'RECOVERY_WORKER',
      state: 'n/a',
      adapter: 'n/a',
      result: 'SWEEP_TICK_START',
      surface: 'RECOVERY_WORKER',
    });
    emitRuntimeProof({
      requirement_id: 'REQ-REC-003',
      event_type: 'WORKER_EXECUTION',
      tenant_id: 'n/a',
      metadata: { worker: 'RecoveryWorker.sweepStaleExecutions', phase: 'start' },
    });

    const timeoutMinutes = parsePositiveInt(
      this.config.get<string>('RECOVERY_TIMEOUT_MINUTES'),
      DEFAULT_TIMEOUT_MINUTES,
    );
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
    const webhookCutoff = new Date(Date.now() - webhookRecoverySilenceMinutes(this.config) * 60_000);
    try {
      await this.webhookRecovery.recoverMissingWebhooksSince(webhookCutoff, MAX_WEBHOOK_RECOVERY_PER_KIND);
    } catch (cause) {
      this.logger.warn(`recovery.worker webhook_recovery sweep error=${String(cause)}`);
      this.structured.emit({
        correlationId: 'n/a',
        tenantId: 'n/a',
        phase: 'RECOVERY_WORKER',
        state: 'n/a',
        adapter: 'n/a',
        result: 'WEBHOOK_RECOVERY_SWEEP_ERROR',
        surface: 'RECOVERY_WORKER',
        message: String(cause),
      });
      emitRuntimeProof({
        requirement_id: 'REQ-WEB-005',
        event_type: 'WORKER_EXECUTION',
        tenant_id: 'n/a',
        metadata: {
          worker: 'RecoveryWorker.webhookRecovery',
          phase: 'error',
          message: String(cause),
        },
      });
    }

    const candidates = await this.findStaleExecutionKeys(cutoff, MAX_CANDIDATES_PER_TICK);
    this.metrics.setWorkerBacklog('recovery_worker', 'sweep_stale_executions', candidates.length);

    for (const c of candidates) {
      const lockKey = `${c.tenantId}\x1f${c.correlationId}`;
      if (this.inFlight.has(lockKey)) {
        this.logger.log(
          `recovery.worker skipped (already running) tenantId=${c.tenantId} correlationId=${c.correlationId}`,
        );
        this.structured.emit({
          correlationId: c.correlationId,
          tenantId: c.tenantId,
          phase: 'RECOVERY_WORKER',
          state: 'in_flight',
          adapter: 'n/a',
          result: 'STALE_RECOVERY_SKIPPED',
          surface: 'RECOVERY_WORKER',
        });
        continue;
      }
      this.inFlight.add(lockKey);
      try {
        const snapshot = await this.recovery.getExecutionSnapshot(c.tenantId, c.correlationId, {
          inferDataNotStarted: false,
          inferSyncAfterPaymentSuccess: true,
        });

        if (snapshot.pending.kind === 'none') {
          continue;
        }

        this.logger.log(
          `recovery.worker attempt tenantId=${c.tenantId} correlationId=${c.correlationId} lastOccurredAt=${c.lastOccurredAt.toISOString()} pendingKind=${snapshot.pending.kind} recoveryTimeoutMinutes=${timeoutMinutes}`,
        );

        this.structured.emit({
          correlationId: c.correlationId,
          tenantId: c.tenantId,
          phase: 'RECOVERY_WORKER',
          state: snapshot.pending.kind,
          adapter: 'n/a',
          result: 'STALE_RECOVERY_ATTEMPT',
          surface: 'RECOVERY_WORKER',
        });

        await this.tenantContext.run(c.tenantId, async () => {
          const result = await this.recovery.recoverExecution(c.tenantId, c.correlationId, {
            inferDataNotStarted: false,
            inferSyncAfterPaymentSuccess: true,
          });

          if (result.action === 'executed') {
            this.logger.log(
              `recovery.worker completed tenantId=${c.tenantId} correlationId=${c.correlationId} action=executed`,
            );
          } else if (result.action === 'noop') {
            this.logger.log(
              `recovery.worker noop tenantId=${c.tenantId} correlationId=${c.correlationId} action=noop`,
            );
          } else {
            const reason =
              result.blockReason ??
              (snapshot.pending.kind === 'blocked' ? snapshot.pending.reason : undefined) ??
              'unknown';
            this.logger.warn(
              `recovery.worker blocked tenantId=${c.tenantId} correlationId=${c.correlationId} action=blocked reason=${reason}`,
            );
          }
        });
      } catch (cause) {
        this.metrics.incWorkerErrorsTotal('recovery_worker', 'sweep_stale_executions', 'execution_recovery_failed');
        this.logger.warn(
          `recovery.worker failed tenantId=${c.tenantId} correlationId=${c.correlationId} error=${String(cause)}`,
        );
        this.structured.emit({
          correlationId: c.correlationId,
          tenantId: c.tenantId,
          phase: 'RECOVERY_WORKER',
          state: 'n/a',
          adapter: 'n/a',
          result: 'STALE_RECOVERY_ERROR',
          surface: 'RECOVERY_WORKER',
          message: String(cause),
        });
        emitRuntimeProof({
          requirement_id: 'REQ-REC-001',
          event_type: 'WORKER_EXECUTION',
          tenant_id: c.tenantId,
          metadata: {
            worker: 'RecoveryWorker.sweepStaleExecutions',
            phase: 'execution_error',
            correlationId: c.correlationId,
            message: String(cause),
          },
        });
      } finally {
        this.inFlight.delete(lockKey);
      }
    }
    emitRuntimeProof({
      requirement_id: 'REQ-REC-003',
      event_type: 'WORKER_EXECUTION',
      tenant_id: 'n/a',
      metadata: {
        worker: 'RecoveryWorker.sweepStaleExecutions',
        phase: 'complete',
        candidates: candidates.length,
      },
    });
    this.metrics.observeWorkerLatencyMs('recovery_worker', 'sweep_stale_executions', Date.now() - started);
  }

  /**
   * Distinct executions whose last transition is older than `cutoff` (for tests and reuse).
   */
  async findStaleExecutionKeys(cutoff: Date, limit: number): Promise<StaleExecutionRow[]> {
    const raw = await this.transitionLog
      .createQueryBuilder('t')
      .select('t.tenantId', 'tenantId')
      .addSelect('t.correlationId', 'correlationId')
      .addSelect('MAX(t.occurredAt)', 'lastOccurredAt')
      .groupBy('t.tenantId')
      .addGroupBy('t.correlationId')
      .having('MAX(t.occurredAt) < :cutoff', { cutoff })
      .orderBy('MAX(t.occurredAt)', 'ASC')
      .limit(limit)
      .getRawMany<{ tenantId: string; correlationId: string; lastOccurredAt: string | Date }>();

    return raw.map((r) => ({
      tenantId: r.tenantId,
      correlationId: r.correlationId,
      lastOccurredAt: r.lastOccurredAt instanceof Date ? r.lastOccurredAt : new Date(r.lastOccurredAt),
    }));
  }
}
