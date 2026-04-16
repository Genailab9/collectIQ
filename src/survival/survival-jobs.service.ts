import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  WebhookRecoveryService,
  webhookRecoverySilenceMinutes,
} from '../recovery/webhook-recovery.service';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { SurvivalJobEntity } from './entities/survival-job.entity';

@Injectable()
export class SurvivalJobsService {
  // LEGACY MIGRATION SURFACE: job persistence still uses repository/query-builder paths during phased query-engine migration.
  private readonly logger = new Logger(SurvivalJobsService.name);
  private static readonly SYSTEM_TENANT_ID = 'admin-plane';

  constructor(
    @InjectRepository(SurvivalJobEntity)
    private readonly jobs: Repository<SurvivalJobEntity>,
    private readonly config: ConfigService,
    private readonly notifications: NotificationOutboxService,
    private readonly webhookRecovery: WebhookRecoveryService,
    private readonly metrics: PrometheusMetricsService,
    private readonly structured: StructuredLoggerService,
  ) {}

  async countPending(): Promise<number> {
    return this.jobs.count({
      where: { tenantId: SurvivalJobsService.SYSTEM_TENANT_ID, status: 'pending' },
    });
  }

  async enqueue(input: {
    queue: string;
    name: string;
    payload?: Record<string, unknown>;
    runAfterMs?: number;
  }): Promise<string> {
    const started = Date.now();
    const id = randomUUID();
    const runAfter = new Date(Date.now() + (input.runAfterMs ?? 0));
    await this.jobs.save(
      this.jobs.create({
        id,
        tenantId: SurvivalJobsService.SYSTEM_TENANT_ID,
        queue: input.queue.trim().slice(0, 64),
        name: input.name.trim().slice(0, 128),
        payloadJson: JSON.stringify(input.payload ?? {}),
        status: 'pending',
        attempts: 0,
        maxAttempts: 5,
        deadLetterReason: null,
        runAfter,
        lastError: null,
      }),
    );
    this.metrics.observeWorkerLatencyMs('survival_jobs', 'enqueue', Date.now() - started);
    void this.refreshQueueDepthGauges();
    return id;
  }

  async summary(requestTenantId: string): Promise<{
    byQueue: Record<string, { pending: number; running: number; dead: number; completed: number }>;
    recent: Array<{
      id: string;
      queue: string;
      name: string;
      status: string;
      attempts: number;
      createdAt: string;
      lastError: string | null;
    }>;
  }> {
    const requestTenant = requestTenantId.trim();
    const rows = await this.jobs.find({
      where: { tenantId: SurvivalJobsService.SYSTEM_TENANT_ID },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const visibleRows = rows.filter((r) => this.isVisibleToTenant(r.payloadJson, requestTenant));
    const byQueue: Record<string, { pending: number; running: number; dead: number; completed: number }> = {};
    for (const row of visibleRows) {
      if (!byQueue[row.queue]) {
        byQueue[row.queue] = { pending: 0, running: 0, dead: 0, completed: 0 };
      }
      const bucket = byQueue[row.queue]!;
      if (row.status === 'pending') {
        bucket.pending += 1;
      } else if (row.status === 'running') {
        bucket.running += 1;
      } else if (row.status === 'dead') {
        bucket.dead += 1;
      } else if (row.status === 'completed') {
        bucket.completed += 1;
      }
    }
    const recent = visibleRows
      .slice(0, 40)
      .map((r) => ({
        id: r.id,
        queue: r.queue,
        name: r.name,
        status: r.status,
        attempts: r.attempts,
        createdAt: r.createdAt.toISOString(),
        lastError: r.lastError,
      }));
    return { byQueue, recent };
  }

  private isVisibleToTenant(payloadJson: string, tenantId: string): boolean {
    if (!tenantId) {
      return false;
    }
    try {
      const payload = JSON.parse(payloadJson) as { tenantId?: unknown };
      if (typeof payload.tenantId !== 'string') {
        return true;
      }
      return payload.tenantId.trim() === tenantId;
    } catch {
      // Invalid payloads stay visible because jobs are system-plane rows.
      return true;
    }
  }

  async processDue(limit = 10): Promise<number> {
    const started = Date.now();
    this.metrics.incWorkerRunsTotal('survival_jobs', 'process_due');
    const now = new Date();
    const batch = await this.jobs
      .createQueryBuilder('j')
      .where('j.tenantId = :tenantId', { tenantId: SurvivalJobsService.SYSTEM_TENANT_ID })
      .andWhere('j.status = :st', { st: 'pending' })
      .andWhere('j.runAfter <= :now', { now })
      .orderBy('j.runAfter', 'ASC')
      .addOrderBy('j.createdAt', 'ASC')
      .take(limit)
      .getMany();
    this.metrics.setWorkerBacklog('survival_jobs', 'process_due', batch.length);

    let n = 0;
    const runningEntries = batch.map((job) => ({ id: job.id, attempts: job.attempts + 1 }));
    await this.markRunningBatch(runningEntries);
    for (const job of batch) {
      job.attempts += 1;
    }
    const completedIds: string[] = [];
    const failedEntries: Array<{
      id: string;
      status: 'pending' | 'dead';
      lastError: string;
      runAfter: Date;
      deadLetterReason: string | null;
    }> = [];
    for (const job of batch) {
      job.status = 'running';
      try {
        await this.runJob(job);
        job.status = 'completed';
        job.lastError = null;
        completedIds.push(job.id);
        n += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        job.lastError = msg.slice(0, 2000);
        if (job.attempts >= job.maxAttempts) {
          job.status = 'dead';
          job.deadLetterReason = msg.slice(0, 500);
        } else {
          job.status = 'pending';
          job.runAfter = new Date(Date.now() + Math.min(600_000, 2 ** job.attempts * 1000));
        }
        failedEntries.push({
          id: job.id,
          status: job.status as 'pending' | 'dead',
          lastError: job.lastError,
          runAfter: job.runAfter,
          deadLetterReason: job.deadLetterReason,
        });
        this.metrics.incWorkerErrorsTotal('survival_jobs', 'process_due', 'job_failed');
        this.logger.warn(`survival_job_failed id=${job.id} queue=${job.queue} ${msg}`);
      }
    }
    await this.markCompletedBatch(completedIds);
    await this.markFailedBatch(failedEntries);
    if (completedIds.length > 0 || failedEntries.length > 0) {
      this.structured.emit({
        correlationId: 'survival-jobs:process_due',
        tenantId: SurvivalJobsService.SYSTEM_TENANT_ID,
        phase: 'CONTROL_PLANE',
        state: 'SURVIVAL_JOBS:BATCH_UPDATE',
        adapter: 'survival.jobs',
        result: 'SYSTEM_PLANE_EVENT',
        surface: 'worker',
        message: `completed=${completedIds.length} failed=${failedEntries.length}`,
      });
    }
    this.metrics.observeWorkerLatencyMs('survival_jobs', 'process_due', Date.now() - started);
    void this.refreshQueueDepthGauges();
    return n;
  }

  private async markRunningBatch(entries: Array<{ id: string; attempts: number }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.jobs
      .createQueryBuilder()
      .update(SurvivalJobEntity)
      .set({ status: 'running', attempts: () => 'attempts + 1' })
      .where('tenantId = :tenantId', { tenantId: SurvivalJobsService.SYSTEM_TENANT_ID })
      .andWhere('id IN (:...ids)', { ids: entries.map((entry) => entry.id) })
      .execute();
  }

  private async markCompletedBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.jobs
      .createQueryBuilder()
      .update(SurvivalJobEntity)
      .set({ status: 'completed', lastError: null })
      .where('tenantId = :tenantId', { tenantId: SurvivalJobsService.SYSTEM_TENANT_ID })
      .andWhere('id IN (:...ids)', { ids })
      .execute();
  }

  private async markFailedBatch(
    entries: Array<{
      id: string;
      status: 'pending' | 'dead';
      lastError: string;
      runAfter: Date;
      deadLetterReason: string | null;
    }>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const ids = entries.map((entry) => entry.id);
    const statusCase = entries.map((entry) => `WHEN '${entry.id}' THEN '${entry.status}'`).join(' ');
    const lastErrorCase = entries
      .map((entry) => `WHEN '${entry.id}' THEN '${entry.lastError.replace(/'/g, "''")}'`)
      .join(' ');
    const runAfterCase = entries
      .map((entry) => `WHEN '${entry.id}' THEN '${entry.runAfter.toISOString()}'`)
      .join(' ');
    const deadLetterCase = entries
      .map((entry) =>
        entry.deadLetterReason
          ? `WHEN '${entry.id}' THEN '${entry.deadLetterReason.replace(/'/g, "''")}'`
          : `WHEN '${entry.id}' THEN NULL`,
      )
      .join(' ');
    await this.jobs.query(
      `
      UPDATE survival_job
      SET
        status = CASE id ${statusCase} ELSE status END,
        last_error = CASE id ${lastErrorCase} ELSE last_error END,
        run_after = CASE id ${runAfterCase} ELSE run_after END,
        dead_letter_reason = CASE id ${deadLetterCase} ELSE dead_letter_reason END
      WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(',')})
      `,
      [SurvivalJobsService.SYSTEM_TENANT_ID, ...ids],
    );
  }

  private async refreshQueueDepthGauges(): Promise<void> {
    const rows = await this.jobs
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .where('j.tenantId = :tenantId', { tenantId: SurvivalJobsService.SYSTEM_TENANT_ID })
      .groupBy('j.status')
      .getRawMany<{ status: string; cnt: string }>();
    let pending = 0;
    let running = 0;
    let failed = 0;
    for (const row of rows) {
      const n = Number.parseInt(row.cnt, 10) || 0;
      if (row.status === 'pending') pending = n;
      else if (row.status === 'running') running = n;
      else if (row.status === 'failed') failed = n;
    }
    this.metrics.setSurvivalQueueDepth('pending', pending);
    this.metrics.setSurvivalQueueDepth('running', running);
    this.metrics.setSurvivalQueueDepth('failed', failed);
  }

  private async runJob(job: SurvivalJobEntity): Promise<void> {
    if (job.queue === 'notifications') {
      await this.notifications.processDueBatch(40);
      return;
    }
    if (job.queue === 'webhook-recovery') {
      const minutes = webhookRecoverySilenceMinutes(this.config);
      await this.webhookRecovery.recoverMissingWebhooksSince(new Date(Date.now() - minutes * 60_000), 50);
      return;
    }
    if (job.queue === 'ingestion-processing' || job.queue === 'sync') {
      return;
    }
    throw new Error(`unknown_queue:${job.queue}`);
  }
}
