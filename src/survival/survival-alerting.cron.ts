import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { SurvivalJobsService } from './survival-jobs.service';

@Injectable()
export class SurvivalAlertingCron {
  private readonly logger = new Logger(SurvivalAlertingCron.name);
  private prevPaymentFailures = 0;
  private prevWebhookNoop = 0;

  constructor(
    private readonly metrics: PrometheusMetricsService,
    private readonly config: ConfigService,
    private readonly jobs: SurvivalJobsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async evaluate(): Promise<void> {
    const payTotal = this.metrics.getCounterSum('collectiq_payment_failures_total');
    const wh = this.metrics.getCounterSum('collectiq_webhook_unmapped_total');
    const deltaPay = payTotal - this.prevPaymentFailures;
    const deltaWh = wh - this.prevWebhookNoop;
    this.prevPaymentFailures = payTotal;
    this.prevWebhookNoop = wh;

    const spikePay = this.parseIntEnv('ALERT_PAYMENT_FAILURE_DELTA_PER_MIN', 25);
    const spikeWh = this.parseIntEnv('ALERT_WEBHOOK_UNMAPPED_DELTA_PER_MIN', 80);
    if (deltaPay >= spikePay) {
      await this.fire(`payment_failure_spike delta=${deltaPay} threshold=${spikePay}`);
    }
    if (deltaWh >= spikeWh) {
      await this.fire(`webhook_unmapped_spike delta=${deltaWh} threshold=${spikeWh}`);
    }

    const backlog = await this.jobs.countPending();
    const maxBacklog = this.parseIntEnv('ALERT_SURVIVAL_JOB_BACKLOG', 500);
    if (backlog >= maxBacklog) {
      await this.fire(`survival_job_backlog count=${backlog} threshold=${maxBacklog}`);
    }
  }

  private parseIntEnv(key: string, fallback: number): number {
    const v = this.config.get<string>(key)?.trim();
    if (!v) {
      return fallback;
    }
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  private async fire(message: string): Promise<void> {
    const url = this.config.get<string>('COLLECTIQ_ALERT_WEBHOOK_URL')?.trim();
    if (url) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'collectiq-survival', message, at: new Date().toISOString() }),
        });
      } catch (e) {
        this.logger.error(`alert_webhook_failed ${String(e)}`);
      }
    }
    this.logger.warn(`ALERT ${message}`);
  }
}
