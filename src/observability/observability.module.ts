import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookEventEntity } from '../adapters/telephony/webhooks/entities/webhook-event.entity';
import { ReadModelModule } from '../modules/read-model/read-model.module';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { MetricsController } from './metrics.controller';
import { ObservabilityController } from './observability.controller';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceExecutionService } from './trace-execution.service';
import { DomainEventsService } from './domain-events.service';
import { SystemEventGraphService } from './system-event-graph.service';
import { SystemEventProjectionService } from './system-event-projection.service';
import { SystemEventProjectionEntity } from './entities/system-event-projection.entity';
import { SystemEventIntegritySnapshotEntity } from './entities/system-event-integrity-snapshot.entity';
import { SystemEventChainAnchorEntity } from './entities/system-event-chain-anchor.entity';
import { TenantFeatureFlagModule } from '../modules/tenant-feature-flags/tenant-feature-flag.module';
import { PolicyModule } from '../policy/policy.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StateTransitionLogEntity,
      SmekOrchestrationAuditEntity,
      IdempotencyKeyEntity,
      WebhookEventEntity,
      SystemEventProjectionEntity,
      SystemEventIntegritySnapshotEntity,
      SystemEventChainAnchorEntity,
    ]),
    ConfigModule,
    PolicyModule,
    TenantFeatureFlagModule,
    ReadModelModule,
  ],
  controllers: [ObservabilityController, MetricsController],
  providers: [
    StructuredLoggerService,
    TraceExecutionService,
    PrometheusMetricsService,
    DomainEventsService,
    SystemEventGraphService,
    SystemEventProjectionService,
  ],
  exports: [
    StructuredLoggerService,
    TraceExecutionService,
    PrometheusMetricsService,
    DomainEventsService,
    SystemEventGraphService,
    SystemEventProjectionService,
  ],
})
export class ObservabilityModule {}
