import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReadModelModule } from '../modules/read-model/read-model.module';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { MetricsController } from './metrics.controller';
import { ObservabilityController } from './observability.controller';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceExecutionService } from './trace-execution.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StateTransitionLogEntity,
      SmekOrchestrationAuditEntity,
      IdempotencyKeyEntity,
    ]),
    ReadModelModule,
  ],
  controllers: [ObservabilityController, MetricsController],
  providers: [StructuredLoggerService, TraceExecutionService, PrometheusMetricsService],
  exports: [StructuredLoggerService, TraceExecutionService, PrometheusMetricsService],
})
export class ObservabilityModule {}
