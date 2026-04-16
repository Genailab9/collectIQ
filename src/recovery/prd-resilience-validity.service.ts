import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookEventEntity } from '../adapters/telephony/webhooks/entities/webhook-event.entity';
import { ResilienceService } from '../common/resilience/resilience.service';
import { ResilienceCircuitOpenError } from '../common/resilience/resilience.errors';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { PaymentGatewayIntentLinkEntity } from '../modules/payment/entities/payment-gateway-intent-link.entity';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { ExecutionRecoveryService } from './execution-recovery.service';

type CheckStatus = 'PASS' | 'FAIL';

export interface ResilienceCheckItem {
  readonly name:
    | 'CAN_RECOVER_EXECUTION'
    | 'CAN_REPLAY_SAFELY'
    | 'NO_DUPLICATE_PAYMENTS'
    | 'WEBHOOKS_IDEMPOTENT'
    | 'CIRCUIT_BREAKER_WORKS';
  readonly status: CheckStatus;
  readonly message: string;
}

export interface PrdResilienceValidityResult {
  readonly result: CheckStatus;
  readonly checks: readonly ResilienceCheckItem[];
}

export interface ProductionGateScope {
  readonly actor: 'system';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return n;
}

@Injectable()
export class PrdResilienceValidityService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @InjectRepository(IdempotencyKeyEntity)
    private readonly idempotencyRows: Repository<IdempotencyKeyEntity>,
    @InjectRepository(PaymentGatewayIntentLinkEntity)
    private readonly paymentLinks: Repository<PaymentGatewayIntentLinkEntity>,
    @InjectRepository(WebhookEventEntity)
    private readonly webhookEvents: Repository<WebhookEventEntity>,
    private readonly recovery: ExecutionRecoveryService,
    private readonly resilience: ResilienceService,
    private readonly config: ConfigService,
  ) {}

  async runProductionGate(_scope: ProductionGateScope): Promise<PrdResilienceValidityResult> {
    const checks = await Promise.all([
      this.checkCanRecoverExecution(),
      this.checkReplaySafety(),
      this.checkNoDuplicatePayments(),
      this.checkWebhookIdempotency(),
      this.checkCircuitBreakerWorks(),
    ]);

    const result: CheckStatus = checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
    return { result, checks };
  }

  private async checkCanRecoverExecution(): Promise<ResilienceCheckItem> {
    const row = await this.transitions
      .createQueryBuilder('t')
      .select('t.tenantId', 'tenantId')
      .addSelect('t.correlationId', 'correlationId')
      .orderBy('t.occurredAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .limit(1)
      .getRawOne<{ tenantId: string; correlationId: string }>();

    if (!row?.tenantId || !row?.correlationId) {
      return {
        name: 'CAN_RECOVER_EXECUTION',
        status: 'PASS',
        message: 'No transition rows exist yet; recovery service is available.',
      };
    }

    try {
      await this.recovery.getExecutionSnapshot(row.tenantId, row.correlationId, {
        inferDataNotStarted: false,
        inferSyncAfterPaymentSuccess: true,
      });
      return {
        name: 'CAN_RECOVER_EXECUTION',
        status: 'PASS',
        message: `Recovery snapshot built for tenant=${row.tenantId} correlation=${row.correlationId}.`,
      };
    } catch (e) {
      return {
        name: 'CAN_RECOVER_EXECUTION',
        status: 'FAIL',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async checkReplaySafety(): Promise<ResilienceCheckItem> {
    const invalidSuccess = await this.idempotencyRows
      .createQueryBuilder('i')
      .where('i.status = :status', { status: 'success' })
      .andWhere('i.responsePayloadJson IS NULL')
      .getCount();
    if (invalidSuccess > 0) {
      return {
        name: 'CAN_REPLAY_SAFELY',
        status: 'FAIL',
        message: `Found ${invalidSuccess} success idempotency rows with null response payload.`,
      };
    }

    const successRows = await this.idempotencyRows.find({
      where: { status: 'success' },
      select: ['id', 'responsePayloadJson', 'responseHash'],
    });
    for (const row of successRows) {
      const payload = row.responsePayloadJson ?? '';
      const hash = createHash('sha256').update(payload).digest('hex');
      if (row.responseHash !== hash) {
        return {
          name: 'CAN_REPLAY_SAFELY',
          status: 'FAIL',
          message: `Idempotency hash mismatch on row=${row.id}.`,
        };
      }
    }

    return {
      name: 'CAN_REPLAY_SAFELY',
      status: 'PASS',
      message: `Validated ${successRows.length} successful idempotency replay rows.`,
    };
  }

  private async checkNoDuplicatePayments(): Promise<ResilienceCheckItem> {
    const duplicateTenantPayment = await this.paymentLinks
      .createQueryBuilder('p')
      .select('COUNT(*)', 'cnt')
      .groupBy('p.tenantId')
      .addGroupBy('p.paymentId')
      .having('COUNT(*) > 1')
      .getRawMany<{ cnt: string }>();

    if (duplicateTenantPayment.length > 0) {
      return {
        name: 'NO_DUPLICATE_PAYMENTS',
        status: 'FAIL',
        message: `Found ${duplicateTenantPayment.length} duplicate tenant/payment gateway bindings.`,
      };
    }

    const duplicateGateway = await this.paymentLinks
      .createQueryBuilder('p')
      .select('COUNT(*)', 'cnt')
      .groupBy('p.gatewayPaymentIntentId')
      .having('COUNT(*) > 1')
      .getRawMany<{ cnt: string }>();

    if (duplicateGateway.length > 0) {
      return {
        name: 'NO_DUPLICATE_PAYMENTS',
        status: 'FAIL',
        message: `Found ${duplicateGateway.length} duplicate gateway_payment_intent_id bindings.`,
      };
    }

    return {
      name: 'NO_DUPLICATE_PAYMENTS',
      status: 'PASS',
      message: 'No duplicate payment intent bindings detected.',
    };
  }

  private async checkWebhookIdempotency(): Promise<ResilienceCheckItem> {
    const duplicateWebhookRows = await this.webhookEvents
      .createQueryBuilder('w')
      .select('COUNT(*)', 'cnt')
      .groupBy('w.provider')
      .addGroupBy('w.externalDedupeKey')
      .having('COUNT(*) > 1')
      .getRawMany<{ cnt: string }>();

    if (duplicateWebhookRows.length > 0) {
      return {
        name: 'WEBHOOKS_IDEMPOTENT',
        status: 'FAIL',
        message: `Found ${duplicateWebhookRows.length} duplicate webhook dedupe keys.`,
      };
    }

    return {
      name: 'WEBHOOKS_IDEMPOTENT',
      status: 'PASS',
      message: 'Webhook dedupe key uniqueness is intact.',
    };
  }

  private async checkCircuitBreakerWorks(): Promise<ResilienceCheckItem> {
    const threshold = parsePositiveInt(this.config.get<string>('RESILIENCE_FAILURE_THRESHOLD'), 5);
    const circuitKey = `prd:resilience-validity:${Date.now()}`;

    for (let i = 0; i < threshold; i += 1) {
      try {
        await this.resilience.executeWithRetry({
          fn: async () => {
            throw new Error('prd_resilience_probe_failure');
          },
          retries: 0,
          backoff: 1,
          circuitKey,
          unsafeAllowRetriesWithoutIdempotencyKey: true,
        });
      } catch {
        // Expected: each call fails and accumulates circuit failures.
      }
    }

    try {
      await this.resilience.executeWithRetry({
        fn: async () => 'ok',
        retries: 0,
        backoff: 1,
        circuitKey,
        unsafeAllowRetriesWithoutIdempotencyKey: true,
      });
      return {
        name: 'CIRCUIT_BREAKER_WORKS',
        status: 'FAIL',
        message: 'Circuit breaker probe unexpectedly succeeded while circuit should be open.',
      };
    } catch (e) {
      if (e instanceof ResilienceCircuitOpenError) {
        return {
          name: 'CIRCUIT_BREAKER_WORKS',
          status: 'PASS',
          message: `Circuit opened and rejected probe until ${new Date(e.openUntil).toISOString()}.`,
        };
      }
      return {
        name: 'CIRCUIT_BREAKER_WORKS',
        status: 'FAIL',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
