import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { PaymentCommandKind } from '../../contracts/payment-command-kind';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { requireSmekCompleted } from '../../kernel/smek-loop-result.guard';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { PaymentMachineState } from '../../state-machine/definitions/payment-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { ApprovalTransitionQueryService } from '../approval/approval-transition-query.service';
import { SyncService } from '../sync/sync.service';
import { PaymentGatewayIntentLinkEntity } from './entities/payment-gateway-intent-link.entity';
import {
  PaymentDuplicateInProgressError,
  PaymentGatewayIntentConflictError,
  PaymentIdempotencyConflictError,
  PaymentIdempotencyRequiredError,
  PaymentStateConflictError,
} from './payment.errors';
import { PaymentTransitionQueryService } from './payment-transition-query.service';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';

const TERMINAL = new Set<string>([
  PaymentMachineState.SUCCESS,
  PaymentMachineState.FAILED,
  PaymentMachineState.REFUNDED,
  PaymentMachineState.DISPUTED,
]);

function assertIdempotencyKeyPresent(raw: string | undefined | null): string {
  const k = raw?.trim() ?? '';
  if (!k) {
    throw new PaymentIdempotencyRequiredError();
  }
  return k;
}

/**
 * PRD v1.1 §8 + PRD §7 — payment lifecycle only via SMEK + transition log; gateway truth from provider + persisted adapter results.
 */
@Injectable()
export class PaymentService {
  private readonly confirmInFlight = new Set<string>();

  constructor(
    private readonly smekKernel: SmekKernelService,
    private readonly paymentTransitions: PaymentTransitionQueryService,
    private readonly approvalTransitions: ApprovalTransitionQueryService,
    private readonly syncService: SyncService,
    @InjectRepository(PaymentGatewayIntentLinkEntity)
    private readonly gatewayIntentLinks: Repository<PaymentGatewayIntentLinkEntity>,
    private readonly metrics: PrometheusMetricsService,
  ) {}

  async getPaymentState(
    tenantId: string,
    paymentId: string,
  ): Promise<{ latestPaymentState: string | null; gatewayPaymentIntentId: string | null }> {
    const latestPaymentState = await this.paymentTransitions.getLatestPaymentToState(
      tenantId,
      paymentId,
    );
    const gatewayPaymentIntentId = await this.resolveRecordedGatewayIntentId(tenantId, paymentId);
    return { latestPaymentState, gatewayPaymentIntentId };
  }


  async createPaymentIntent(params: {
    tenantId: string;
    idempotencyKey: string;
    amountCents: number;
    currency?: string;
    approvalCorrelationId: string;
    borrowerOptedOut?: boolean;
  }): Promise<{ paymentId: string; toState: string; gatewayPaymentIntentId: string }> {
    assertIdempotencyKeyPresent(params.idempotencyKey);
    const currency = (params.currency ?? 'usd').toLowerCase();
    if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
      throw new PaymentStateConflictError('amountCents must be a positive integer.');
    }

    const existingPaymentId = await this.paymentTransitions.findPaymentIdByIdempotencyKey(
      params.tenantId,
      params.idempotencyKey,
    );
    const paymentId = existingPaymentId ?? randomUUID();

    await this.assertApprovalApproved(params.tenantId, params.approvalCorrelationId);
    if (existingPaymentId) {
      await this.assertCreateParamsMatchBootstrap(
        existingPaymentId,
        params.tenantId,
        params.amountCents,
        currency,
        params.approvalCorrelationId,
      );
      const done = await this.tryReturnCompletedCreateIntent(
        params.tenantId,
        existingPaymentId,
        params.amountCents,
        currency,
        params.approvalCorrelationId,
      );
      if (done) {
        await this.ensureGatewayIntentLink(params.tenantId, done.paymentId, done.gatewayPaymentIntentId);
        return done;
      }
    }

    const gatewayIdempotencyKey = `collectiq_pi_${params.tenantId}_${params.idempotencyKey}`;

    try {
      requireSmekCompleted(
        await this.smekKernel.executeLoop({
          phase: ExecutionLoopPhase.PAY,
          transition: {
            tenantId: params.tenantId,
            correlationId: paymentId,
            machine: MachineKind.PAYMENT,
            from: PaymentMachineState.ALTERNATE_METHOD,
            to: PaymentMachineState.INITIATED,
            actor: 'payment-service',
            metadata: {
              idempotencyKey: params.idempotencyKey,
              amountCents: params.amountCents,
              currency,
              approvalCorrelationId: params.approvalCorrelationId,
            },
          },
          adapterEnvelope: null,
          complianceGate: {
            tenantId: params.tenantId,
            correlationId: paymentId,
            executionPhase: ExecutionLoopPhase.PAY,
            borrowerOptedOut: params.borrowerOptedOut,
          },
          paymentIngress: { source: 'INTERNAL_BOOTSTRAP' },
          idempotency: {
            key: params.idempotencyKey,
            step: IdempotencyStep.PaymentCreateBootstrap,
          },
        }),
        (m) => new PaymentStateConflictError(m),
      );

      const { adapterResult } = requireSmekCompleted(
        await this.smekKernel.executeLoop({
          phase: ExecutionLoopPhase.PAY,
          transition: {
            tenantId: params.tenantId,
            correlationId: paymentId,
            machine: MachineKind.PAYMENT,
            from: PaymentMachineState.INITIATED,
            to: PaymentMachineState.PROCESSING,
            actor: 'payment-service',
            metadata: {
              idempotencyKey: params.idempotencyKey,
              amountCents: params.amountCents,
              currency,
              step: PaymentCommandKind.CreateIntent,
              approvalCorrelationId: params.approvalCorrelationId,
            },
          },
          adapterEnvelope: {
            kind: PaymentCommandKind.CreateIntent,
            body: {
              paymentId,
              tenantId: params.tenantId,
              amountCents: params.amountCents,
              currency,
              gatewayIdempotencyKey,
              approvalCorrelationId: params.approvalCorrelationId,
            },
          },
          complianceGate: {
            tenantId: params.tenantId,
            correlationId: paymentId,
            executionPhase: ExecutionLoopPhase.PAY,
            borrowerOptedOut: params.borrowerOptedOut,
          },
          idempotency: {
            key: params.idempotencyKey,
            step: IdempotencyStep.PaymentCreateProcessing,
          },
        }),
        (m) => new PaymentStateConflictError(m),
      );

      const gatewayPayload = adapterResult as { gatewayPaymentIntentId?: string } | undefined;
      const gid = gatewayPayload?.gatewayPaymentIntentId;
      if (!gid) {
        throw new PaymentStateConflictError('Gateway did not return a PaymentIntent id.');
      }

      await this.bindGatewayIntentOrThrow(params.tenantId, paymentId, gid);

      return { paymentId, toState: PaymentMachineState.PROCESSING, gatewayPaymentIntentId: gid };
    } catch (e) {
      this.metrics.incPaymentFailures('create_intent');
      throw e;
    }
  }

  async confirmPayment(params: {
    tenantId: string;
    paymentId: string;
    gatewayPaymentIntentId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<{ toState: string }> {
    assertIdempotencyKeyPresent(params.idempotencyKey);
    const clientGid = params.gatewayPaymentIntentId.trim();
    if (!clientGid) {
      throw new PaymentStateConflictError('gatewayPaymentIntentId is required.');
    }

    const recordedGid = await this.resolveRecordedGatewayIntentId(params.tenantId, params.paymentId);
    if (!recordedGid) {
      throw new PaymentStateConflictError(
        'No recorded gateway PaymentIntent id for this payment; cannot confirm.',
      );
    }
    if (clientGid !== recordedGid) {
      throw new PaymentStateConflictError(
        'gatewayPaymentIntentId does not match the provider-bound PaymentIntent for this payment.',
      );
    }

    const latest = await this.paymentTransitions.getLatestPaymentToState(
      params.tenantId,
      params.paymentId,
    );
    if (!latest) {
      throw new PaymentStateConflictError('Payment machine has no recorded transitions yet.');
    }

    if (latest === PaymentMachineState.SUCCESS) {
      await this.ensureSyncAfterPaymentSuccess({
        tenantId: params.tenantId,
        paymentId: params.paymentId,
        idempotencyKey: params.idempotencyKey,
        borrowerOptedOut: params.borrowerOptedOut,
      });
      return { toState: PaymentMachineState.SUCCESS };
    }
    if (latest === PaymentMachineState.FAILED) {
      throw new PaymentStateConflictError('Payment is FAILED; cannot confirm.');
    }
    if (latest !== PaymentMachineState.PROCESSING) {
      throw new PaymentStateConflictError(
        `Cannot confirm payment from state "${latest}" (expected PROCESSING).`,
      );
    }

    const lockKey = `${params.tenantId}:${params.paymentId}`;
    if (this.confirmInFlight.has(lockKey)) {
      throw new PaymentDuplicateInProgressError();
    }
    this.confirmInFlight.add(lockKey);
    try {
      const latestInside = await this.paymentTransitions.getLatestPaymentToState(
        params.tenantId,
        params.paymentId,
      );
      if (latestInside === PaymentMachineState.SUCCESS) {
        await this.ensureSyncAfterPaymentSuccess({
          tenantId: params.tenantId,
          paymentId: params.paymentId,
          idempotencyKey: params.idempotencyKey,
          borrowerOptedOut: params.borrowerOptedOut,
        });
        return { toState: PaymentMachineState.SUCCESS };
      }
      if (latestInside !== PaymentMachineState.PROCESSING) {
        throw new PaymentStateConflictError(
          `Cannot confirm payment from state "${String(latestInside)}" (expected PROCESSING).`,
        );
      }

      await this.runPayConfirmSmekAndSync({
        tenantId: params.tenantId,
        paymentId: params.paymentId,
        gatewayPaymentIntentId: recordedGid,
        idempotencyKey: params.idempotencyKey,
        borrowerOptedOut: params.borrowerOptedOut,
      });
    } finally {
      this.confirmInFlight.delete(lockKey);
    }

    return { toState: PaymentMachineState.SUCCESS };
  }

  private async runPayConfirmSmekAndSync(params: {
    tenantId: string;
    paymentId: string;
    gatewayPaymentIntentId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const gid = params.gatewayPaymentIntentId.trim();
    const stripeConfirmIdempotencyKey = this.stripeConfirmIdempotencyKey(params.tenantId, params.paymentId);

    try {
      requireSmekCompleted(
        await this.smekKernel.executeLoop({
          phase: ExecutionLoopPhase.PAY,
          transition: {
            tenantId: params.tenantId,
            correlationId: params.paymentId,
            machine: MachineKind.PAYMENT,
            from: PaymentMachineState.PROCESSING,
            to: PaymentMachineState.SUCCESS,
            actor: 'payment-service',
            metadata: {
              step: PaymentCommandKind.ConfirmPayment,
              gatewayPaymentIntentId: gid,
            },
          },
          adapterEnvelope: {
            kind: PaymentCommandKind.ConfirmPayment,
            body: {
              paymentId: params.paymentId,
              tenantId: params.tenantId,
              gatewayPaymentIntentId: gid,
              stripeConfirmIdempotencyKey,
            },
          },
          complianceGate: {
            tenantId: params.tenantId,
            correlationId: params.paymentId,
            executionPhase: ExecutionLoopPhase.PAY,
            borrowerOptedOut: params.borrowerOptedOut,
          },
          idempotency: {
            key: params.idempotencyKey,
            step: IdempotencyStep.PaymentConfirmTransition,
          },
        }),
        (m) => new PaymentStateConflictError(m),
      );

      const bootstrap = await this.paymentTransitions.getBootstrapMetadataForPayment(
        params.tenantId,
        params.paymentId,
      );
      if (!bootstrap) {
        throw new PaymentStateConflictError('Payment bootstrap metadata missing; cannot run settlement sync.');
      }
      await this.syncService.runPostPaymentSettlementSync({
        tenantId: params.tenantId,
        paymentId: params.paymentId,
        approvalCorrelationId: bootstrap.approvalCorrelationId,
        idempotencyKey: params.idempotencyKey,
        borrowerOptedOut: params.borrowerOptedOut,
      });
    } catch (e) {
      this.metrics.incPaymentFailures('confirm');
      throw e;
    }
  }

  private stripeConfirmIdempotencyKey(tenantId: string, paymentId: string): string {
    return `collectiq:stripe:confirm:${tenantId}:${paymentId}`;
  }

  private async ensureSyncAfterPaymentSuccess(params: {
    tenantId: string;
    paymentId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const bootstrap = await this.paymentTransitions.getBootstrapMetadataForPayment(
      params.tenantId,
      params.paymentId,
    );
    if (!bootstrap) {
      throw new PaymentStateConflictError('Payment bootstrap metadata missing; cannot run settlement sync.');
    }
    await this.syncService.runPostPaymentSettlementSync({
      tenantId: params.tenantId,
      paymentId: params.paymentId,
      approvalCorrelationId: bootstrap.approvalCorrelationId,
      idempotencyKey: params.idempotencyKey,
      borrowerOptedOut: params.borrowerOptedOut,
    });
  }

  private async resolveRecordedGatewayIntentId(
    tenantId: string,
    paymentId: string,
  ): Promise<string | null> {
    const fromAudit = await this.paymentTransitions.getLatestGatewayPaymentIntentId(
      tenantId,
      paymentId,
    );
    if (fromAudit) {
      return fromAudit;
    }
    const row = await this.gatewayIntentLinks.findOne({ where: { tenantId, paymentId } });
    return row?.gatewayPaymentIntentId ?? null;
  }

  private async bindGatewayIntentOrThrow(tenantId: string, paymentId: string, gid: string): Promise<void> {
    const byGid = await this.gatewayIntentLinks.findOne({
      where: { tenantId, gatewayPaymentIntentId: gid },
    });
    if (byGid && byGid.paymentId !== paymentId) {
      throw new PaymentGatewayIntentConflictError(
        `gateway_payment_intent_id "${gid}" is already bound to another payment.`,
      );
    }
    const byPayment = await this.gatewayIntentLinks.findOne({ where: { tenantId, paymentId } });
    if (byPayment && byPayment.gatewayPaymentIntentId !== gid) {
      throw new PaymentStateConflictError('Payment is already bound to a different gateway PaymentIntent id.');
    }
    if (byGid) {
      return;
    }
    await this.gatewayIntentLinks.save(
      this.gatewayIntentLinks.create({ tenantId, paymentId, gatewayPaymentIntentId: gid }),
    );
  }

  private async ensureGatewayIntentLink(
    tenantId: string,
    paymentId: string,
    gid: string,
  ): Promise<void> {
    await this.bindGatewayIntentOrThrow(tenantId, paymentId, gid);
  }

  private async assertApprovalApproved(tenantId: string, approvalCorrelationId: string): Promise<void> {
    const latest = await this.approvalTransitions.getLatestApprovalToState(
      tenantId,
      approvalCorrelationId,
    );
    if (latest !== ApprovalMachineState.APPROVED) {
      throw new PaymentStateConflictError(
        `Payment requires APPROVED approval for correlation "${approvalCorrelationId}" (latest="${String(latest)}").`,
      );
    }
  }

  private async assertCreateParamsMatchBootstrap(
    paymentId: string,
    tenantId: string,
    amountCents: number,
    currency: string,
    approvalCorrelationId: string,
  ): Promise<void> {
    const bootstrap = await this.paymentTransitions.getBootstrapMetadataForPayment(
      tenantId,
      paymentId,
    );
    if (!bootstrap) {
      return;
    }
    if (
      bootstrap.amountCents !== amountCents ||
      bootstrap.currency !== currency ||
      bootstrap.approvalCorrelationId !== approvalCorrelationId
    ) {
      throw new PaymentIdempotencyConflictError(
        'Idempotency key already used with different amount, currency, or approval correlation.',
      );
    }
  }

  private async tryReturnCompletedCreateIntent(
    tenantId: string,
    paymentId: string,
    amountCents: number,
    currency: string,
    approvalCorrelationId: string,
  ): Promise<{ paymentId: string; toState: string; gatewayPaymentIntentId: string } | null> {
    const latest = await this.paymentTransitions.getLatestPaymentToState(tenantId, paymentId);
    if (latest !== PaymentMachineState.PROCESSING) {
      return null;
    }
    const gid = await this.resolveRecordedGatewayIntentId(tenantId, paymentId);
    if (!gid) {
      return null;
    }
    await this.assertCreateParamsMatchBootstrap(
      paymentId,
      tenantId,
      amountCents,
      currency,
      approvalCorrelationId,
    );
    return { paymentId, toState: latest, gatewayPaymentIntentId: gid };
  }

}
