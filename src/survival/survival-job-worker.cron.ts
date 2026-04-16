import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SurvivalJobsService } from './survival-jobs.service';
import { emitRuntimeProof } from '../runtime-proof/runtime-proof-emitter';

@Injectable()
export class SurvivalJobWorkerCron {
  private readonly logger = new Logger(SurvivalJobWorkerCron.name);

  constructor(private readonly jobs: SurvivalJobsService) {}

  @Cron('*/10 * * * * *')
  async tick(): Promise<void> {
    emitRuntimeProof({
      requirement_id: 'REQ-RATE-002',
      event_type: 'WORKER_EXECUTION',
      tenant_id: 'n/a',
      metadata: { worker: 'SurvivalJobWorkerCron.tick', phase: 'start' },
    });
    try {
      const n = await this.jobs.processDue(8);
      if (n > 0) {
        this.logger.log(`survival_jobs_processed n=${n}`);
      }
      emitRuntimeProof({
        requirement_id: 'REQ-RATE-002',
        event_type: 'WORKER_EXECUTION',
        tenant_id: 'n/a',
        metadata: { worker: 'SurvivalJobWorkerCron.tick', phase: 'success', processed: n },
      });
    } catch (e) {
      this.logger.error(`survival_job_worker_failed ${String(e)}`);
      emitRuntimeProof({
        requirement_id: 'REQ-RATE-002',
        event_type: 'WORKER_EXECUTION',
        tenant_id: 'n/a',
        metadata: { worker: 'SurvivalJobWorkerCron.tick', phase: 'error', message: String(e) },
      });
    }
  }
}
