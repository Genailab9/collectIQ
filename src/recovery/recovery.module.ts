import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelephonyWebhookModule } from '../adapters/telephony/webhooks/telephony-webhook.module';
import { WebhookEventEntity } from '../adapters/telephony/webhooks/entities/webhook-event.entity';
import { ResilienceModule } from '../common/resilience/resilience.module';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { KernelModule } from '../kernel/kernel.module';
import { PaymentGatewayIntentLinkEntity } from '../modules/payment/entities/payment-gateway-intent-link.entity';
import { PaymentModule } from '../modules/payment/payment.module';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { ExecutionRecoveryService } from './execution-recovery.service';
import { PrdResilienceValidityService } from './prd-resilience-validity.service';
import { RecoveryWorker } from './recovery.worker';
import { SystemResilienceController } from './system-resilience.controller';
import { WebhookRecoveryService } from './webhook-recovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StateTransitionLogEntity,
      SmekOrchestrationAuditEntity,
      IdempotencyKeyEntity,
      PaymentGatewayIntentLinkEntity,
      WebhookEventEntity,
    ]),
    StateMachineModule,
    KernelModule,
    PaymentModule,
    TelephonyWebhookModule,
    ResilienceModule,
  ],
  controllers: [SystemResilienceController],
  providers: [ExecutionRecoveryService, RecoveryWorker, WebhookRecoveryService, PrdResilienceValidityService],
  exports: [ExecutionRecoveryService, WebhookRecoveryService],
})
export class RecoveryModule {}
