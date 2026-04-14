import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyStep } from '../../../contracts/idempotency-step';
import { ExecutionLoopPhase } from '../../../contracts/execution-loop-phase';
import { SmekKernelService } from '../../../kernel/smek-kernel.service';
import { PrometheusMetricsService } from '../../../observability/prometheus-metrics.service';
import { PaymentGatewayIntentLinkEntity } from '../../../modules/payment/entities/payment-gateway-intent-link.entity';
import { PaymentMachineState } from '../../../state-machine/definitions/payment-machine.definition';
import { StateTransitionLogEntity } from '../../../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../../../state-machine/types/machine-kind';
import { WebhookEventService } from '../../telephony/webhooks/webhook-event.service';
import { SaaSUsageService } from '../../../saas/saas-usage.service';

const STRIPE_PROVIDER = 'stripe';

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly smekKernel: SmekKernelService,
    private readonly webhookEvents: WebhookEventService,
    @InjectRepository(PaymentGatewayIntentLinkEntity)
    private readonly links: Repository<PaymentGatewayIntentLinkEntity>,
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @Optional() private readonly saasUsage?: SaaSUsageService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {}

  private incUnmapped(reason: string): void {
    try {
      this.metrics?.incWebhookUnmapped(reason);
    } catch {
      // metrics must not break webhooks
    }
  }

  async handlePaymentIntentEvent(input: {
    tenantId: string;
    eventId: string;
    gatewayPaymentIntentId: string;
    providerStatus: string;
    rawPayload: Record<string, unknown>;
  }): Promise<void> {
    const tenantId = input.tenantId.trim();
    const eventId = input.eventId.trim();
    const gatewayPaymentIntentId = input.gatewayPaymentIntentId.trim();
    const providerStatus = input.providerStatus.trim().toLowerCase();
    if (!tenantId || !eventId || !gatewayPaymentIntentId || !providerStatus) {
      return;
    }

    const begin = await this.webhookEvents.beginIngest({
      provider: STRIPE_PROVIDER,
      tenantId,
      correlationId: gatewayPaymentIntentId,
      externalDedupeKey: `stripe:event:${eventId}`,
      rawPayload: input.rawPayload as Record<string, string>,
    });
    if (begin.mode === 'duplicate') {
      return;
    }

    const link = await this.links.findOne({ where: { tenantId, gatewayPaymentIntentId } });
    if (!link) {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'stripe.payment_intent',
        outcome: 'NO_PAYMENT_LINK',
        eventId,
        gatewayPaymentIntentId,
      });
      return;
    }

    const latest = await this.latestPaymentTransition(link.tenantId, link.paymentId);
    const fromState = latest?.toState ?? null;

    if (providerStatus !== 'succeeded' || fromState !== PaymentMachineState.PROCESSING) {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'stripe.payment_intent',
        outcome: 'NOOP_UNMAPPED_OR_INVALID_STATE',
        providerStatus,
        fromState,
        paymentId: link.paymentId,
      });
      this.incUnmapped('payment_intent_noop');
      return;
    }

    const result = await this.smekKernel.executeLoop({
      phase: ExecutionLoopPhase.PAY,
      transition: {
        tenantId: link.tenantId,
        correlationId: link.paymentId,
        machine: MachineKind.PAYMENT,
        from: PaymentMachineState.PROCESSING,
        to: PaymentMachineState.SUCCESS,
        actor: 'stripe-webhook',
        metadata: {
          provider: STRIPE_PROVIDER,
          webhookEventId: eventId,
          gatewayPaymentIntentId,
          providerStatus,
        },
      },
      adapterEnvelope: null,
      complianceGate: {
        tenantId: link.tenantId,
        correlationId: link.paymentId,
        executionPhase: ExecutionLoopPhase.PAY,
        borrowerOptedOut: false,
      },
      paymentIngress: { source: 'GATEWAY_WEBHOOK' },
      idempotency: {
        key: `webhook:${eventId}`,
        step: IdempotencyStep.WebhookStripePaymentStatus,
      },
    });
    if (result.outcome !== 'COMPLETED') {
      throw new ForbiddenException('Stripe webhook blocked by compliance.');
    }

    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'stripe.payment_intent',
      outcome: 'COMPLETED',
      paymentId: link.paymentId,
      providerStatus,
    });

    if (this.saasUsage) {
      try {
        await this.saasUsage.incrementPaymentsProcessed(link.tenantId, 1);
      } catch {
        // metering must not break webhooks
      }
    }
  }

  async handleChargeRefunded(input: {
    tenantId: string;
    eventId: string;
    gatewayPaymentIntentId: string;
    rawPayload: Record<string, unknown>;
  }): Promise<void> {
    const tenantId = input.tenantId.trim();
    const eventId = input.eventId.trim();
    const gatewayPaymentIntentId = input.gatewayPaymentIntentId.trim();
    if (!tenantId || !eventId || !gatewayPaymentIntentId) {
      return;
    }
    const begin = await this.webhookEvents.beginIngest({
      provider: STRIPE_PROVIDER,
      tenantId,
      correlationId: gatewayPaymentIntentId,
      externalDedupeKey: `stripe:refund:${eventId}`,
      rawPayload: input.rawPayload as Record<string, string>,
    });
    if (begin.mode === 'duplicate') {
      return;
    }
    const link = await this.links.findOne({ where: { tenantId, gatewayPaymentIntentId } });
    if (!link) {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'stripe.charge.refunded',
        outcome: 'NO_PAYMENT_LINK',
        gatewayPaymentIntentId,
      });
      this.incUnmapped('refund_no_link');
      return;
    }
    const latest = await this.latestPaymentTransition(link.tenantId, link.paymentId);
    const fromState = latest?.toState ?? null;
    if (fromState !== PaymentMachineState.SUCCESS) {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'stripe.charge.refunded',
        outcome: 'NOOP_INVALID_FROM',
        fromState,
        paymentId: link.paymentId,
      });
      this.incUnmapped('refund_bad_state');
      return;
    }
    const result = await this.smekKernel.executeLoop({
      phase: ExecutionLoopPhase.PAY,
      transition: {
        tenantId: link.tenantId,
        correlationId: link.paymentId,
        machine: MachineKind.PAYMENT,
        from: PaymentMachineState.SUCCESS,
        to: PaymentMachineState.REFUNDED,
        actor: 'stripe-webhook',
        metadata: {
          provider: STRIPE_PROVIDER,
          webhookEventId: eventId,
          gatewayPaymentIntentId,
          kind: 'charge.refunded',
        },
      },
      adapterEnvelope: null,
      complianceGate: {
        tenantId: link.tenantId,
        correlationId: link.paymentId,
        executionPhase: ExecutionLoopPhase.PAY,
        borrowerOptedOut: false,
      },
      paymentIngress: { source: 'GATEWAY_WEBHOOK' },
      idempotency: {
        key: `webhook:refund:${eventId}`,
        step: IdempotencyStep.WebhookStripeRefund,
      },
    });
    if (result.outcome !== 'COMPLETED') {
      throw new ForbiddenException('Stripe refund webhook blocked by compliance.');
    }
    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'stripe.charge.refunded',
      outcome: 'COMPLETED',
      paymentId: link.paymentId,
    });
  }

  async handleChargeDisputeCreated(input: {
    tenantId: string;
    eventId: string;
    gatewayPaymentIntentId: string;
    rawPayload: Record<string, unknown>;
  }): Promise<void> {
    const tenantId = input.tenantId.trim();
    const eventId = input.eventId.trim();
    const gatewayPaymentIntentId = input.gatewayPaymentIntentId.trim();
    if (!tenantId || !eventId || !gatewayPaymentIntentId) {
      return;
    }
    const begin = await this.webhookEvents.beginIngest({
      provider: STRIPE_PROVIDER,
      tenantId,
      correlationId: gatewayPaymentIntentId,
      externalDedupeKey: `stripe:dispute:${eventId}`,
      rawPayload: input.rawPayload as Record<string, string>,
    });
    if (begin.mode === 'duplicate') {
      return;
    }
    const link = await this.links.findOne({ where: { tenantId, gatewayPaymentIntentId } });
    if (!link) {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'stripe.dispute.created',
        outcome: 'NO_PAYMENT_LINK',
        gatewayPaymentIntentId,
      });
      this.incUnmapped('dispute_no_link');
      return;
    }
    const latest = await this.latestPaymentTransition(link.tenantId, link.paymentId);
    const fromState = latest?.toState ?? null;
    if (fromState !== PaymentMachineState.SUCCESS) {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'stripe.dispute.created',
        outcome: 'NOOP_INVALID_FROM',
        fromState,
        paymentId: link.paymentId,
      });
      this.incUnmapped('dispute_bad_state');
      return;
    }
    const result = await this.smekKernel.executeLoop({
      phase: ExecutionLoopPhase.PAY,
      transition: {
        tenantId: link.tenantId,
        correlationId: link.paymentId,
        machine: MachineKind.PAYMENT,
        from: PaymentMachineState.SUCCESS,
        to: PaymentMachineState.DISPUTED,
        actor: 'stripe-webhook',
        metadata: {
          provider: STRIPE_PROVIDER,
          webhookEventId: eventId,
          gatewayPaymentIntentId,
          kind: 'charge.dispute.created',
        },
      },
      adapterEnvelope: null,
      complianceGate: {
        tenantId: link.tenantId,
        correlationId: link.paymentId,
        executionPhase: ExecutionLoopPhase.PAY,
        borrowerOptedOut: false,
      },
      paymentIngress: { source: 'GATEWAY_WEBHOOK' },
      idempotency: {
        key: `webhook:dispute:${eventId}`,
        step: IdempotencyStep.WebhookStripeDispute,
      },
    });
    if (result.outcome !== 'COMPLETED') {
      throw new ForbiddenException('Stripe dispute webhook blocked by compliance.');
    }
    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'stripe.dispute.created',
      outcome: 'COMPLETED',
      paymentId: link.paymentId,
    });
  }

  private async latestPaymentTransition(
    tenantId: string,
    paymentId: string,
  ): Promise<StateTransitionLogEntity | null> {
    return this.transitions
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.correlationId = :paymentId', { paymentId })
      .andWhere('t.machine = :machine', { machine: MachineKind.PAYMENT })
      .orderBy('t.occurredAt', 'DESC')
      .getOne();
  }
}
