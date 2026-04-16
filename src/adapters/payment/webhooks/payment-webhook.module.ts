import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { KernelModule } from '../../../kernel/kernel.module';
import { EventsStreamModule } from '../../../events/stream/events-stream.module';
import { ObservabilityModule } from '../../../observability/observability.module';
import { SaaSCoreModule } from '../../../saas/saas-core.module';
import { PaymentModule } from '../../../modules/payment/payment.module';
import { SyncModule } from '../../../modules/sync/sync.module';
import { PaymentGatewayIntentLinkEntity } from '../../../modules/payment/entities/payment-gateway-intent-link.entity';
import { StateTransitionLogEntity } from '../../../state-machine/entities/state-transition-log.entity';
import { WebhookEventEntity } from '../../telephony/webhooks/entities/webhook-event.entity';
import { WebhookEventService } from '../../telephony/webhooks/webhook-event.service';
import { StripeWebhookController } from './stripe.controller';
import { StripeWebhookSignatureGuard } from './stripe-webhook.signature.guard';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([WebhookEventEntity, PaymentGatewayIntentLinkEntity, StateTransitionLogEntity]),
    KernelModule,
    EventsStreamModule,
    ObservabilityModule,
    SaaSCoreModule,
    PaymentModule,
    SyncModule,
  ],
  controllers: [StripeWebhookController],
  providers: [WebhookEventService, StripeWebhookSignatureGuard, StripeWebhookService],
})
export class PaymentWebhookModule {}
