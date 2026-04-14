import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  WebhookRecoveryService,
  webhookRecoverySilenceMinutes,
} from '../recovery/webhook-recovery.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { SurvivalJobEntity } from './entities/survival-job.entity';

@Injectable()
export class SurvivalJobsService {
  private readonly logger = new Logger(SurvivalJobsService.name);

  constructor(
    @InjectRepository(SurvivalJobEntity)
    private readonly jobs: Repository<SurvivalJobEntity>,
    private readonly config: ConfigService,
    private readonly notifications: NotificationOutboxService,
    private readonly webhookRecovery: WebhookRecoveryService,
  ) {}

  async countPending(): Promise<number> {
    return this.jobs.count({ where: { status: 'pending' } });
  }

  async enqueue(input: {
    queue: string;
    name: string;
    payload?: Record<string, unknown>;
    runAfterMs?: number;
  }): Promise<string> {
    const id = randomUUID();
    const runAfter = new Date(Date.now() + (input.runAfterMs ?? 0));
    await this.jobs.save(
      this.jobs.create({
        id,
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
    return id;
  }

  async summary(): Promise<{
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
    const raw = await this.jobs
      .createQueryBuilder('j')
      .select('j.queue', 'queue')
      .addSelect('j.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('j.queue')
      .addGroupBy('j.status')
      .getRawMany<{ queue: string; status: string; cnt: string }>();

    const byQueue: Record<
      string,
      { pending: number; running: number; failed: number; dead: number; completed: number }
    > = {};
    for (const r of raw) {
      if (!byQueue[r.queue]) {
        byQueue[r.queue] = { pending: 0, running: 0, failed: 0, dead: 0, completed: 0 };
      }
      const n = Number.parseInt(r.cnt, 10) || 0;
      const b = byQueue[r.queue]!;
      if (r.status === 'pending') {
        b.pending += n;
      } else if (r.status === 'running') {
        b.running += n;
      } else if (r.status === 'dead') {
        b.dead += n;
      } else if (r.status === 'completed') {
        b.completed += n;
      } else if (r.status === 'failed') {
        b.failed += n;
      }
    }

    const rows = await this.jobs.find({ order: { createdAt: 'DESC' }, take: 40 });
    const recent = rows.map((r) => ({
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

  async processDue(limit = 10): Promise<number> {
    const now = new Date();
    const batch = await this.jobs
      .createQueryBuilder('j')
      .where('j.status = :st', { st: 'pending' })
      .andWhere('j.runAfter <= :now', { now })
      .orderBy('j.runAfter', 'ASC')
      .addOrderBy('j.createdAt', 'ASC')
      .take(limit)
      .getMany();

    let n = 0;
    for (const job of batch) {
      job.status = 'running';
      job.attempts += 1;
      await this.jobs.save(job);
      try {
        await this.runJob(job);
        job.status = 'completed';
        job.lastError = null;
        await this.jobs.save(job);
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
        await this.jobs.save(job);
        this.logger.warn(`survival_job_failed id=${job.id} queue=${job.queue} ${msg}`);
      }
    }
    return n;
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
