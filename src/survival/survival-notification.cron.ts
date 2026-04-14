import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationOutboxService } from './notification-outbox.service';

@Injectable()
export class SurvivalNotificationCron {
  private readonly logger = new Logger(SurvivalNotificationCron.name);

  constructor(private readonly notifications: NotificationOutboxService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async drainOutbox(): Promise<void> {
    try {
      const n = await this.notifications.processDueBatch(30);
      if (n > 0) {
        this.logger.log(`notification_outbox_delivered n=${n}`);
      }
    } catch (e) {
      this.logger.error(`notification_outbox_cron_failed ${String(e)}`);
    }
  }
}
