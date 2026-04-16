import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { NotificationFeedEntity } from './entities/notification-feed.entity';
import { NotificationOutboxEntity } from './entities/notification-outbox.entity';

function isUniqueViolation(e: unknown): boolean {
  if (!(e instanceof QueryFailedError)) {
    return false;
  }
  const d = e.driverError as { code?: string; errno?: number } | undefined;
  return d?.code === 'SQLITE_CONSTRAINT' || d?.errno === 19;
}

function backoffSeconds(attempt: number): number {
  return Math.min(900, Math.max(5, 2 ** Math.min(attempt, 10)));
}

@Injectable()
export class NotificationOutboxService {
  // LEGACY MIGRATION SURFACE: outbox persistence remains on repository/query-builder primitives until engine migration batch.
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(
    @InjectRepository(NotificationOutboxEntity)
    private readonly outbox: Repository<NotificationOutboxEntity>,
    @InjectRepository(NotificationFeedEntity)
    private readonly feed: Repository<NotificationFeedEntity>,
    private readonly config: ConfigService,
    private readonly metrics: PrometheusMetricsService,
    private readonly structured: StructuredLoggerService,
  ) {}

  /**
   * Idempotent fan-out from a persisted transition row (internal feed + optional email/webhook channels).
   */
  async onPersistedTransition(row: StateTransitionLogEntity): Promise<void> {
    const tenantId = row.tenantId.trim();
    const dedupeBase = `transition:${row.id}`;
    const title = `${row.machine} ${row.fromState}→${row.toState}`;
    const body = `Correlation ${row.correlationId} · actor ${row.actor ?? 'n/a'}`;
    const meta = {
      correlationId: row.correlationId,
      machine: row.machine,
      from: row.fromState,
      to: row.toState,
      actor: row.actor,
      occurredAt: row.occurredAt.toISOString(),
    };

    const feedRow = this.feed.create({
      id: randomUUID(),
      tenantId,
      correlationId: row.correlationId,
      title,
      body,
      severity: 'info',
      metadataJson: JSON.stringify(meta),
      readAt: null,
    });
    await this.feed.save(feedRow);

    const channels = this.resolveChannels();
    const now = new Date();
    const pendingInserts: NotificationOutboxEntity[] = [];
    for (const channel of channels) {
      if (channel === 'internal') {
        continue;
      }
      const dedupeKey = `${dedupeBase}:${channel}`;
      const payload = { channel, transition: meta };
      try {
        pendingInserts.push(
          this.outbox.create({
          id: randomUUID(),
          tenantId,
          channel,
          dedupeKey,
          payloadJson: JSON.stringify(payload),
          status: 'pending',
          attempts: 0,
          maxAttempts: 8,
          nextRetryAt: now,
          lastError: null,
          }),
        );
      } catch (e) {
        if (!isUniqueViolation(e)) {
          this.logger.warn(`notification_outbox_insert_failed channel=${channel} err=${String(e)}`);
        }
      }
    }
    if (pendingInserts.length > 0) {
      try {
        await this.outbox
          .createQueryBuilder()
          .insert()
          .into(NotificationOutboxEntity)
          .values(pendingInserts)
          .orIgnore()
          .execute();
      } catch (e) {
        if (!isUniqueViolation(e)) {
          this.logger.warn(`notification_outbox_insert_failed err=${String(e)}`);
        }
      }
    }
  }

  private resolveChannels(): string[] {
    const raw = this.config.get<string>('COLLECTIQ_NOTIFICATION_CHANNELS')?.trim();
    if (!raw) {
      return ['internal'];
    }
    const parts = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    const set = new Set<string>(['internal', ...parts]);
    return [...set];
  }

  async processDueBatch(limit = 25): Promise<number> {
    const started = Date.now();
    this.metrics.incWorkerRunsTotal('notification_outbox', 'process_due_batch');
    const tenants = await this.listDueTenants(limit);
    this.metrics.setWorkerBacklog('notification_outbox', 'process_due_batch_tenants', tenants.length);
    let done = 0;
    for (const tenantId of tenants) {
      const now = new Date();
      const due = await this.outbox
        .createQueryBuilder('o')
        .where('o.tenantId = :tenantId', { tenantId })
        .andWhere('o.status IN (:...st)', { st: ['pending', 'failed'] })
        .andWhere('(o.nextRetryAt IS NULL OR o.nextRetryAt <= :now)', { now })
        .orderBy('o.nextRetryAt', 'ASC')
        .addOrderBy('o.createdAt', 'ASC')
        .take(limit)
        .getMany();
      const runningEntries = due
        .filter((row) => row.status !== 'dead' && row.status !== 'sent')
        .map((row) => ({ id: row.id, attempts: row.attempts + 1 }));
      await this.markRunningBatch(tenantId, runningEntries);
      for (const row of due) {
        if (row.status !== 'dead' && row.status !== 'sent') {
          row.attempts += 1;
          row.status = 'sending';
        }
      }
      const completedIds: string[] = [];
      const failedEntries: Array<{
        id: string;
        status: 'failed' | 'dead';
        lastError: string;
        nextRetryAt: Date | null;
      }> = [];
      for (const row of due) {
        if (row.status === 'dead' || row.status === 'sent') {
          continue;
        }
        try {
          if (row.channel === 'email') {
            await this.sendEmail(row);
          } else if (row.channel === 'webhook') {
            await this.sendWebhook(row);
          } else {
            throw new Error(`unsupported_channel:${row.channel}`);
          }
          row.status = 'sent';
          row.lastError = null;
          row.nextRetryAt = null;
          completedIds.push(row.id);
          done += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          row.lastError = msg.slice(0, 2000);
          if (row.attempts >= row.maxAttempts) {
            row.status = 'dead';
            row.nextRetryAt = null;
          } else {
            row.status = 'failed';
            row.nextRetryAt = new Date(Date.now() + backoffSeconds(row.attempts) * 1000);
          }
          failedEntries.push({
            id: row.id,
            status: row.status as 'failed' | 'dead',
            lastError: row.lastError,
            nextRetryAt: row.nextRetryAt,
          });
          this.metrics.incWorkerErrorsTotal('notification_outbox', 'process_due_batch', 'delivery_failed');
          this.logger.warn(`notification_delivery_failed id=${row.id} channel=${row.channel} ${msg}`);
        }
      }
      await this.markCompletedBatch(tenantId, completedIds);
      await this.markFailedBatch(tenantId, failedEntries);
      if (completedIds.length > 0 || failedEntries.length > 0) {
        this.structured.emit({
          correlationId: `notification-outbox:${tenantId}`,
          tenantId,
          phase: 'CONTROL_PLANE',
          state: 'NOTIFICATION_OUTBOX:BATCH_UPDATE',
          adapter: 'notification.outbox',
          result: 'SYSTEM_PLANE_EVENT',
          surface: 'worker',
          message: `completed=${completedIds.length} failed=${failedEntries.length}`,
        });
      }
    }
    this.metrics.observeWorkerLatencyMs('notification_outbox', 'process_due_batch', Date.now() - started);
    void this.refreshOutboxDepthGauges();
    return done;
  }

  private async listDueTenants(limit: number): Promise<string[]> {
    const now = new Date();
    const rows = await this.outbox
      .createQueryBuilder('o')
      .select('o.tenantId', 'tenantId')
      .where('o.tenantId IS NOT NULL')
      .andWhere('o.tenantId <> :empty', { empty: '' })
      .andWhere('o.status IN (:...st)', { st: ['pending', 'failed'] })
      .andWhere('(o.nextRetryAt IS NULL OR o.nextRetryAt <= :now)', { now })
      .groupBy('o.tenantId')
      .orderBy('MIN(o.nextRetryAt)', 'ASC')
      .limit(limit)
      .getRawMany<{ tenantId: string }>();
    return rows.map((r) => r.tenantId);
  }

  private async markRunningBatch(
    tenantId: string,
    entries: Array<{ id: string; attempts: number }>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.outbox
      .createQueryBuilder()
      .update(NotificationOutboxEntity)
      .set({ status: 'sending', attempts: () => 'attempts + 1' })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('id IN (:...ids)', { ids: entries.map((entry) => entry.id) })
      .execute();
  }

  private async markCompletedBatch(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.outbox
      .createQueryBuilder()
      .update(NotificationOutboxEntity)
      .set({ status: 'sent', lastError: null, nextRetryAt: null })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('id IN (:...ids)', { ids })
      .execute();
  }

  private async markFailedBatch(
    tenantId: string,
    entries: Array<{
      id: string;
      status: 'failed' | 'dead';
      lastError: string;
      nextRetryAt: Date | null;
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
    const nextRetryCase = entries
      .map((entry) =>
        entry.nextRetryAt
          ? `WHEN '${entry.id}' THEN '${entry.nextRetryAt.toISOString()}'`
          : `WHEN '${entry.id}' THEN NULL`,
      )
      .join(' ');
    await this.outbox.query(
      `
      UPDATE notification_outbox
      SET
        status = CASE id ${statusCase} ELSE status END,
        last_error = CASE id ${lastErrorCase} ELSE last_error END,
        next_retry_at = CASE id ${nextRetryCase} ELSE next_retry_at END
      WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(',')})
      `,
      [tenantId, ...ids],
    );
  }

  private async refreshOutboxDepthGauges(): Promise<void> {
    const rows = await this.outbox
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .where('o.tenantId IS NOT NULL')
      .andWhere('o.tenantId <> :empty', { empty: '' })
      .groupBy('o.status')
      .getRawMany<{ status: string; cnt: string }>();
    let pending = 0;
    let failed = 0;
    let sending = 0;
    for (const row of rows) {
      const n = Number.parseInt(row.cnt, 10) || 0;
      if (row.status === 'pending') pending = n;
      else if (row.status === 'failed') failed = n;
      else if (row.status === 'sending') sending = n;
    }
    this.metrics.setSurvivalQueueDepth('outbox_pending', pending);
    this.metrics.setSurvivalQueueDepth('outbox_failed', failed);
    this.metrics.setSurvivalQueueDepth('outbox_sending', sending);
  }

  private async sendEmail(row: NotificationOutboxEntity): Promise<void> {
    const smtpUrl = this.config.get<string>('COLLECTIQ_SMTP_URL')?.trim();
    if (!smtpUrl) {
      throw new Error('COLLECTIQ_SMTP_URL not configured');
    }
    const to = this.config.get<string>('COLLECTIQ_NOTIFICATION_EMAIL_TO')?.trim();
    if (!to) {
      throw new Error('COLLECTIQ_NOTIFICATION_EMAIL_TO not configured');
    }
    const transport = nodemailer.createTransport(smtpUrl);
    const payload = JSON.parse(row.payloadJson) as { transition?: Record<string, unknown> };
    await transport.sendMail({
      from: this.config.get<string>('COLLECTIQ_NOTIFICATION_EMAIL_FROM')?.trim() || 'collectiq@localhost',
      to,
      subject: `[CollectIQ] ${row.tenantId} transition`,
      text: JSON.stringify(payload.transition ?? payload, null, 2),
    });
  }

  private async sendWebhook(row: NotificationOutboxEntity): Promise<void> {
    const url = this.config.get<string>('COLLECTIQ_NOTIFICATION_WEBHOOK_URL')?.trim();
    if (!url) {
      throw new Error('COLLECTIQ_NOTIFICATION_WEBHOOK_URL not configured');
    }
    const secret = this.config.get<string>('COLLECTIQ_NOTIFICATION_WEBHOOK_SECRET')?.trim() ?? '';
    const body = row.payloadJson;
    const sig = secret
      ? createHmac('sha256', secret).update(body).digest('hex')
      : '';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sig ? { 'X-CollectIQ-Signature': `sha256=${sig}` } : {}),
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`webhook_http_${res.status}`);
    }
  }
}
