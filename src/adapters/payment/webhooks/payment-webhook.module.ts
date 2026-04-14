import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { KernelModule } from '../../../kernel/kernel.module';
import { ObservabilityModule } from '../../../observability/observability.module';
import { SaaSCoreModule } from '../../../saas/saas-core.module';
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
    ObservabilityModule,
    SaaSCoreModule,
  ],
  controllers: [StripeWebhookController],
  providers: [WebhookEventService, StripeWebhookSignatureGuard, StripeWebhookService],
})
export class PaymentWebhookModule {}
