import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
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
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(
    @InjectRepository(NotificationOutboxEntity)
    private readonly outbox: Repository<NotificationOutboxEntity>,
    @InjectRepository(NotificationFeedEntity)
    private readonly feed: Repository<NotificationFeedEntity>,
    private readonly config: ConfigService,
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
    for (const channel of channels) {
      if (channel === 'internal') {
        continue;
      }
      const dedupeKey = `${dedupeBase}:${channel}`;
      const payload = { channel, transition: meta };
      try {
        const o = this.outbox.create({
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
        });
        await this.outbox.save(o);
      } catch (e) {
        if (!isUniqueViolation(e)) {
          this.logger.warn(`notification_outbox_insert_failed channel=${channel} err=${String(e)}`);
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
    const now = new Date();
    const due = await this.outbox
      .createQueryBuilder('o')
      .where('o.status IN (:...st)', { st: ['pending', 'failed'] })
      .andWhere('(o.nextRetryAt IS NULL OR o.nextRetryAt <= :now)', { now })
      .orderBy('o.nextRetryAt', 'ASC')
      .addOrderBy('o.createdAt', 'ASC')
      .take(limit)
      .getMany();
    let done = 0;
    for (const row of due) {
      if (row.status === 'dead' || row.status === 'sent') {
        continue;
      }
      row.status = 'sending';
      row.attempts += 1;
      await this.outbox.save(row);
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
        await this.outbox.save(row);
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
        await this.outbox.save(row);
        this.logger.warn(`notification_delivery_failed id=${row.id} channel=${row.channel} ${msg}`);
      }
    }
    return done;
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
