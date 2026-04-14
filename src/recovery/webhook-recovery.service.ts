import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TwilioWebhookService } from '../adapters/telephony/webhooks/twilio-webhook.service';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { IdempotencyStep } from '../contracts/idempotency-step';
import { PaymentCommandKind } from '../contracts/payment-command-kind';
import { TelephonyCommandKind } from '../contracts/telephony-command-kind';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SmekKernelService } from '../kernel/smek-kernel.service';
import { requireSmekCompleted } from '../kernel/smek-loop-result.guard';
import { PaymentGatewayIntentLinkEntity } from '../modules/payment/entities/payment-gateway-intent-link.entity';
import { PaymentService } from '../modules/payment/payment.service';
import { PaymentTransitionQueryService } from '../modules/payment/payment-transition-query.service';
import { PaymentMachineState } from '../state-machine/definitions/payment-machine.definition';
import { CallTransitionQueryService } from '../adapters/telephony/call-transition-query.service';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../state-machine/types/machine-kind';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';

const DEFAULT_WEBHOOK_SILENCE_MINUTES = 3;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, 24 * 60);
}

function normalizeTwilioStatus(status: string): string {
  return status.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * PRD §6.3 — webhook-first processing with fallback recovery when callbacks are missing.
 */
@Injectable()
export class WebhookRecoveryService {
  private readonly logger = new Logger(WebhookRecoveryService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitionLog: Repository<StateTransitionLogEntity>,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    @InjectRepository(PaymentGatewayIntentLinkEntity)
    private readonly paymentIntentLinks: Repository<PaymentGatewayIntentLinkEntity>,
    private readonly atRestCipher: AtRestCipherService,
    private readonly callTransitions: CallTransitionQueryService,
    private readonly paymentTransitions: PaymentTransitionQueryService,
    private readonly smekKernel: SmekKernelService,
    private readonly payments: PaymentService,
    private readonly twilioWebhooks: TwilioWebhookService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    private readonly structured: StructuredLoggerService,
  ) {}

  /** Fallback sweep for active CALL / PAYMENT rows whose last transition is older than `cutoff`. */
  async recoverMissingWebhooksSince(cutoff: Date, maxPerKind: number): Promise<void> {
    const enabled = (this.config.get<string>('WEBHOOK_RECOVERY_ENABLED', 'true') ?? 'true').toLowerCase();
    if (enabled === 'false' || enabled === '0') {
      return;
    }
    await this.recoverCalls(cutoff, maxPerKind);
    await this.recoverPayments(cutoff, maxPerKind);
  }

  private async recoverCalls(cutoff: Date, limit: number): Promise<void> {
    const rows = await this.findCallCorrelationStaleSince(cutoff, limit);
    for (const row of rows) {
      const lockKey = `call:${row.tenantId}:${row.correlationId}`;
      if (this.inFlight.has(lockKey)) {
        continue;
      }
      this.inFlight.add(lockKey);
      try {
        const latest = await this.callTransitions.getLatestCallToState(row.tenantId, row.correlationId);
        if (!latest || this.isCallTerminal(latest)) {
          continue;
        }
        const callSid = await this.findLatestCallSidFromAudit(row.tenantId, row.correlationId);
        if (!callSid) {
          this.logger.debug(
            `webhook.recovery.call_skip_no_callSid tenantId=${row.tenantId} correlationId=${row.correlationId}`,
          );
          continue;
        }

        this.structured.emit({
          correlationId: row.correlationId,
          tenantId: row.tenantId,
          phase: 'WEBHOOK_RECOVERY',
          state: 'CALL_POLL',
          adapter: 'TELEPHONY_PROVIDER.getStatus',
          result: 'ADAPTER_START',
          surface: 'WEBHOOK_RECOVERY',
        });
        let remote: { status: string };
        try {
          remote = await this.getTelephonyStatusViaSmek({
            tenantId: row.tenantId,
            correlationId: row.correlationId,
            currentCallState: latest,
            callSid,
          });
          this.structured.emit({
            correlationId: row.correlationId,
            tenantId: row.tenantId,
            phase: 'WEBHOOK_RECOVERY',
            state: 'CALL_POLL',
            adapter: 'TELEPHONY_PROVIDER.getStatus',
            result: 'ADAPTER_SUCCESS',
            surface: 'WEBHOOK_RECOVERY',
            message: `providerStatus=${remote.status}`,
          });
        } catch (cause) {
          this.structured.emit({
            correlationId: row.correlationId,
            tenantId: row.tenantId,
            phase: 'WEBHOOK_RECOVERY',
            state: 'CALL_POLL',
            adapter: 'TELEPHONY_PROVIDER.getStatus',
            result: 'ADAPTER_ERROR',
            surface: 'WEBHOOK_RECOVERY',
            message: String(cause),
          });
          throw cause;
        }
        const statusNorm = normalizeTwilioStatus(remote.status);
        const idempotencyKey = `recovery:twilio_voice:${row.tenantId}:${row.correlationId}:${statusNorm}`;

        await this.tenantContext.run(row.tenantId, async () => {
          const outcome = await this.twilioWebhooks.executeRecoveryVoiceStatus({
            tenantId: row.tenantId,
            correlationId: row.correlationId,
            providerCallStatus: remote.status,
            idempotencyKey,
          });
          if (outcome.kind === 'applied') {
            this.logger.log(
              `webhook.recovery.call_applied tenantId=${row.tenantId} correlationId=${row.correlationId} providerStatus=${remote.status}`,
            );
          } else if (outcome.kind === 'ignored') {
            this.logger.warn(
              `webhook.recovery.call_ignored tenantId=${row.tenantId} correlationId=${row.correlationId} reason=${outcome.reason}`,
            );
          } else if (outcome.kind === 'compliance_blocked') {
            this.logger.warn(
              `webhook.recovery.call_compliance tenantId=${row.tenantId} correlationId=${row.correlationId} code=${outcome.result.blockCode}`,
            );
          }
        });
      } catch (cause) {
        this.logger.warn(
          `webhook.recovery.call_failed tenantId=${row.tenantId} correlationId=${row.correlationId} error=${String(cause)}`,
        );
      } finally {
        this.inFlight.delete(lockKey);
      }
    }
  }

  private async recoverPayments(cutoff: Date, limit: number): Promise<void> {
    const rows = await this.findPaymentCorrelationStaleSince(cutoff, limit);
    for (const row of rows) {
      const lockKey = `pay:${row.tenantId}:${row.paymentId}`;
      if (this.inFlight.has(lockKey)) {
        continue;
      }
      this.inFlight.add(lockKey);
      try {
        const latest = await this.paymentTransitions.getLatestPaymentToState(row.tenantId, row.paymentId);
        if (latest !== PaymentMachineState.PROCESSING) {
          continue;
        }
        const gid = await this.resolveGatewayPaymentIntentId(row.tenantId, row.paymentId);
        if (!gid) {
          continue;
        }

        const out = await this.getPaymentStatusViaSmek({
          tenantId: row.tenantId,
          paymentId: row.paymentId,
          gatewayPaymentIntentId: gid,
        });
        if (out.status !== 'succeeded') {
          continue;
        }
        await this.reconcilePaymentSuccessViaSmek({
          tenantId: row.tenantId,
          paymentId: row.paymentId,
          gatewayPaymentIntentId: gid,
        });
        this.logger.log(
          `webhook.recovery.payment_reconciled tenantId=${row.tenantId} paymentId=${row.paymentId} providerStatus=${out.status}`,
        );
      } catch (cause) {
        this.logger.warn(
          `webhook.recovery.payment_failed tenantId=${row.tenantId} paymentId=${row.paymentId} error=${String(cause)}`,
        );
      } finally {
        this.inFlight.delete(lockKey);
      }
    }
  }

  private isCallTerminal(state: string): boolean {
    return state === 'COMPLETED' || state === 'FAILED';
  }

  private async findCallCorrelationStaleSince(
    cutoff: Date,
    limit: number,
  ): Promise<{ readonly tenantId: string; readonly correlationId: string }[]> {
    const raw = await this.transitionLog
      .createQueryBuilder('t')
      .select('t.tenantId', 'tenantId')
      .addSelect('t.correlationId', 'correlationId')
      .addSelect('MAX(t.occurredAt)', 'lastAt')
      .where('t.machine = :m', { m: MachineKind.CALL })
      .groupBy('t.tenantId')
      .addGroupBy('t.correlationId')
      .having('MAX(t.occurredAt) < :cutoff', { cutoff })
      .orderBy('MAX(t.occurredAt)', 'ASC')
      .limit(limit)
      .getRawMany<{ tenantId: string; correlationId: string; lastAt: string | Date }>();

    return raw.map((r) => ({ tenantId: r.tenantId, correlationId: r.correlationId }));
  }

  private async findPaymentCorrelationStaleSince(
    cutoff: Date,
    limit: number,
  ): Promise<{ readonly tenantId: string; readonly paymentId: string }[]> {
    const cutoffIso = cutoff.toISOString();
    const raw = await this.transitionLog
      .createQueryBuilder('t')
      .select('t.tenantId', 'tenantId')
      .addSelect('t.correlationId', 'paymentId')
      .addSelect('MAX(t.occurredAt)', 'lastAt')
      .where('t.machine = :m', { m: MachineKind.PAYMENT })
      .groupBy('t.tenantId')
      .addGroupBy('t.correlationId')
      .having('datetime(MAX(t.occurredAt)) < datetime(:cutoffIso)', { cutoffIso })
      .orderBy('MAX(t.occurredAt)', 'ASC')
      .limit(limit)
      .getRawMany<{ tenantId: string; paymentId: string }>();

    return raw.map((r) => ({ tenantId: r.tenantId, paymentId: r.paymentId }));
  }

  private async findLatestCallSidFromAudit(
    tenantId: string,
    correlationId: string,
  ): Promise<string | null> {
    const rows = await this.audits
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.correlationId = :correlationId', { correlationId })
      .andWhere('a.kind = :kind', { kind: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterResult })
      .andWhere('a.executionPhase = :phase', { phase: ExecutionLoopPhase.CALL })
      .orderBy('a.createdAt', 'DESC')
      .take(25)
      .getMany();

    for (const row of rows) {
      try {
        const payload = JSON.parse(this.atRestCipher.openPayloadJson(row.payloadJson)) as {
          adapterResult?: { callSid?: string; status?: string };
        };
        const sid = payload.adapterResult?.callSid?.trim();
        if (sid) {
          return sid;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async getTelephonyStatusViaSmek(params: {
    tenantId: string;
    correlationId: string;
    currentCallState: string;
    callSid: string;
  }): Promise<{ status: string }> {
    const out = requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.CALL,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          machine: MachineKind.CALL,
          from: params.currentCallState,
          to: params.currentCallState,
          actor: 'webhook-recovery',
          metadata: { readOnly: true, operation: TelephonyCommandKind.GetStatus },
        },
        adapterEnvelope: {
          kind: TelephonyCommandKind.GetStatus,
          body: { callSid: params.callSid },
          nonMutating: true,
        },
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          executionPhase: ExecutionLoopPhase.CALL,
          borrowerOptedOut: false,
        },
      }),
      (m) => new Error(m),
    );
    return out.adapterResult as { status: string };
  }

  private async resolveGatewayPaymentIntentId(
    tenantId: string,
    paymentId: string,
  ): Promise<string | null> {
    const fromAudit = await this.paymentTransitions.getLatestGatewayPaymentIntentId(tenantId, paymentId);
    if (fromAudit) {
      return fromAudit;
    }
    const link = await this.paymentIntentLinks.findOne({ where: { tenantId, paymentId } });
    return link?.gatewayPaymentIntentId ?? null;
  }

  private async getPaymentStatusViaSmek(params: {
    tenantId: string;
    paymentId: string;
    gatewayPaymentIntentId: string;
  }): Promise<{ status: string }> {
    const out = requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.PAY,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.paymentId,
          machine: MachineKind.PAYMENT,
          from: PaymentMachineState.PROCESSING,
          to: PaymentMachineState.PROCESSING,
          actor: 'webhook-recovery',
          metadata: { readOnly: true, operation: PaymentCommandKind.RetrieveIntent },
        },
        adapterEnvelope: {
          kind: PaymentCommandKind.RetrieveIntent,
          body: { gatewayPaymentIntentId: params.gatewayPaymentIntentId },
          nonMutating: true,
        },
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.paymentId,
          executionPhase: ExecutionLoopPhase.PAY,
          borrowerOptedOut: false,
        },
      }),
      (m) => new Error(m),
    );
    return out.adapterResult as { status: string };
  }

  private async reconcilePaymentSuccessViaSmek(params: {
    tenantId: string;
    paymentId: string;
    gatewayPaymentIntentId: string;
  }): Promise<void> {
    await this.tenantContext.run(params.tenantId, async () => {
      await this.payments.confirmPayment({
        tenantId: params.tenantId,
        paymentId: params.paymentId,
        gatewayPaymentIntentId: params.gatewayPaymentIntentId,
        idempotencyKey: `recovery:payment:${params.tenantId}:${params.paymentId}:succeeded`,
      });
    });
  }
}

export function webhookRecoverySilenceMinutes(config: ConfigService): number {
  return parsePositiveInt(config.get<string>('WEBHOOK_RECOVERY_SILENCE_MINUTES'), DEFAULT_WEBHOOK_SILENCE_MINUTES);
}
