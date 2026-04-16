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
import { TenantEventStreamService } from '../../../events/stream/tenant-event-stream.service';
import { SyncService } from '../../../modules/sync/sync.service';
import { PaymentTransitionQueryService } from '../../../modules/payment/payment-transition.query';
import { tenantAls } from '../../../tenant/tenant-als';

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
    private readonly syncService: SyncService,
    private readonly paymentTransitions: PaymentTransitionQueryService,
    @Optional() private readonly saasUsage?: SaaSUsageService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
    @Optional() private readonly eventStream?: TenantEventStreamService,
  ) {}

  async resolveTenantIdForGatewayPaymentIntentId(
    gatewayPaymentIntentId: string,
  ): Promise<string | null> {
    const gid = gatewayPaymentIntentId.trim();
    if (!gid) {
      return null;
    }
    return tenantAls.run({ tenantId: 'system:webhook-tenant-resolve' }, async () => {
      const row = await this.links.findOne({ where: { gatewayPaymentIntentId: gid } });
      return row?.tenantId?.trim() || null;
    });
  }

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
    const bootstrap = await this.paymentTransitions.getBootstrapMetadataForPayment(
      link.tenantId,
      link.paymentId,
    );
    if (!bootstrap) {
      throw new ForbiddenException(
        'Payment bootstrap metadata missing; cannot run settlement sync after webhook success.',
      );
    }
    await this.syncService.runPostPaymentSettlementSync({
      tenantId: link.tenantId,
      paymentId: link.paymentId,
      approvalCorrelationId: bootstrap.approvalCorrelationId,
      idempotencyKey: `webhook:sync:${eventId}`,
      borrowerOptedOut: false,
    });

    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'stripe.payment_intent',
      outcome: 'COMPLETED',
      paymentId: link.paymentId,
      providerStatus,
    });

    this.eventStream?.emit({
      occurredAt: new Date().toISOString(),
      envelope: 'WEBHOOK_EVENT',
      tenantId,
      correlationId: link.paymentId,
      provider: STRIPE_PROVIDER,
      kind: 'stripe.payment_intent',
      outcome: 'COMPLETED',
      detail: { gatewayPaymentIntentId, providerStatus },
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
    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'stripe.charge.refunded',
      outcome: 'IGNORED_PAYMENT_SUCCESS_TERMINAL',
      paymentId: link.paymentId,
      fromState,
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
    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'stripe.dispute.created',
      outcome: 'IGNORED_PAYMENT_SUCCESS_TERMINAL',
      paymentId: link.paymentId,
      fromState,
    });
  }

  private async latestPaymentTransition(
    tenantId: string,
    paymentId: string,
  ): Promise<StateTransitionLogEntity | null> {
    return this.transitions.findOne({
      where: {
        tenantId,
        correlationId: paymentId,
        machine: MachineKind.PAYMENT,
      },
      order: { occurredAt: 'DESC' },
    });
  }
}
