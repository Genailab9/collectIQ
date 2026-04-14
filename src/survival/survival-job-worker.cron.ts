import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SurvivalJobsService } from './survival-jobs.service';

@Injectable()
export class SurvivalJobWorkerCron {
  private readonly logger = new Logger(SurvivalJobWorkerCron.name);

  constructor(private readonly jobs: SurvivalJobsService) {}

  @Cron('*/10 * * * * *')
  async tick(): Promise<void> {
    try {
      const n = await this.jobs.processDue(8);
      if (n > 0) {
        this.logger.log(`survival_jobs_processed n=${n}`);
      }
    } catch (e) {
      this.logger.error(`survival_job_worker_failed ${String(e)}`);
    }
  }
}
