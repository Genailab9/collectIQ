import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObservabilityModule } from '../observability/observability.module';
import { RecoveryModule } from '../recovery/recovery.module';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuditPdfService } from './audit-pdf.service';
import { SurvivalAlertingCron } from './survival-alerting.cron';
import { SurvivalCoreModule } from './survival-core.module';
import { SurvivalJobWorkerCron } from './survival-job-worker.cron';
import { SurvivalJobsController } from './survival-jobs.controller';
import { SurvivalJobsService } from './survival-jobs.service';
import { SurvivalNotificationCron } from './survival-notification.cron';

@Module({
  imports: [
    SurvivalCoreModule,
    ObservabilityModule,
    RecoveryModule,
    TypeOrmModule.forFeature([StateTransitionLogEntity, SmekOrchestrationAuditEntity]),
  ],
  controllers: [AnalyticsController, SurvivalJobsController],
  providers: [
    AnalyticsService,
    AuditPdfService,
    SurvivalJobsService,
    SurvivalNotificationCron,
    SurvivalJobWorkerCron,
    SurvivalAlertingCron,
  ],
  exports: [SurvivalJobsService, AnalyticsService, AuditPdfService, SurvivalCoreModule],
})
export class SurvivalModule {}
