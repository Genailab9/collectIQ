import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelModule } from '../../../kernel/kernel.module';
import { EventsStreamModule } from '../../../events/stream/events-stream.module';
import { StateMachineModule } from '../../../state-machine/state-machine.module';
import { StateTransitionLogEntity } from '../../../state-machine/entities/state-transition-log.entity';
import { CallTransitionQueryService } from '../call-transition-query.service';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import { TwilioVoiceStatusWebhookController } from './twilio-voice-status-webhook.controller';
import { TwilioWebhookService } from './twilio-webhook.service';
import { TwilioWebhookSignatureGuard } from './twilio-webhook.signature.guard';
import { WebhookEventService } from './webhook-event.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StateTransitionLogEntity, WebhookEventEntity]),
    StateMachineModule,
    KernelModule,
    EventsStreamModule,
  ],
  controllers: [TwilioVoiceStatusWebhookController],
  providers: [
    TwilioWebhookSignatureGuard,
    CallTransitionQueryService,
    WebhookEventService,
    TwilioWebhookService,
  ],
  exports: [TwilioWebhookService, CallTransitionQueryService],
})
export class TelephonyWebhookModule {}
