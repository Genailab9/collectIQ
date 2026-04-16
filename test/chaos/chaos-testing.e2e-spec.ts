import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
// supertest is CJS; avoid default-import interop issues under ts-jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks';
import { AppModule } from '../../src/app.module';
import { PAYMENT_PROVIDER } from '../../src/adapters/adapter.tokens';
import { TwilioTelephonyAdapter } from '../../src/adapters/telephony/twilio/twilio-telephony.adapter';
import { TwilioWebhookSignatureGuard } from '../../src/adapters/telephony/webhooks/twilio-webhook.signature.guard';
import { TenantCompliancePolicyEntity } from '../../src/compliance/entities/tenant-compliance-policy.entity';
import { ExecutionRecoveryService } from '../../src/recovery/execution-recovery.service';
import { PaymentService } from '../../src/modules/payment/payment.service';
import { StripeWebhookService } from '../../src/adapters/payment/webhooks/stripe-webhook.service';
import { PaymentGatewayIntentLinkEntity } from '../../src/modules/payment/entities/payment-gateway-intent-link.entity';
import { TenantApprovalPolicyEntity } from '../../src/modules/approval/entities/tenant-approval-policy.entity';
import { StateTransitionLogEntity } from '../../src/state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../../src/state-machine/types/machine-kind';
import { PaymentMachineState } from '../../src/state-machine/definitions/payment-machine.definition';
import { ApprovalMachineState } from '../../src/state-machine/definitions/approval-machine.definition';
import { CallMachineState } from '../../src/state-machine/definitions/call-machine.definition';
import { SMEK_OUTCOME } from '../../src/kernel/smek-kernel.dto';
import { IdempotencyKeyEntity } from '../../src/idempotency/entities/idempotency-key.entity';
import { ChaosPaymentAdapter } from './support/chaos-payment.adapter';

const TENANT = 'chaos-e2e-tenant';
const PRD_PKT_START = 9;
const PRD_PKT_END = 20;

async function seedTenantBasics(ds: DataSource): Promise<void> {
  const compliance = ds.getRepository(TenantCompliancePolicyEntity);
  const approval = ds.getRepository(TenantApprovalPolicyEntity);
  await compliance.save({
    tenantId: TENANT,
    callWindowStartHourLocal: PRD_PKT_START,
    callWindowEndHourLocal: PRD_PKT_END,
    maxCallAttemptsFromInitiated: 12,
    enabled: true,
  });
  await approval.save({
    tenantId: TENANT,
    bandLowCents: 1,
    bandHighCents: 10_000_000,
    minOfferCents: null,
    maxOfferCents: null,
    pendingTimeoutSeconds: 3600,
  });
}

const stubTelephonyAdapter = {
  initiateCall: async () => ({ callSid: 'CA_CHAOS_STUB', status: 'queued' }),
  getStatus: async () => ({ callSid: 'CA_CHAOS_STUB', status: 'completed' }),
  terminateCall: async () => ({ callSid: 'CA_CHAOS_STUB', status: 'completed' }),
};

describe('Chaos testing suite (e2e)', () => {
  let app: INestApplication | undefined;
  let dataSource!: DataSource;
  let dbPath: string;
  let chaosPayment: ChaosPaymentAdapter;

  function nest(): INestApplication {
    if (!app) {
      throw new Error('Nest application was not bootstrapped.');
    }
    return app;
  }

  beforeAll(async () => {
    dbPath = join(tmpdir(), `collectiq-chaos-${randomUUID()}.db`);
    mkdirSync(tmpdir(), { recursive: true });

    process.env.COLLECTIQ_STATE_DB_PATH = dbPath;
    process.env.STRIPE_SECRET_KEY = 'sk_test_chaos_dummy';
    process.env.TWILIO_ACCOUNT_SID = 'ACchaos_e2e';
    process.env.TWILIO_AUTH_TOKEN = 'chaos_twilio_auth_token';
    process.env.PUBLIC_WEBHOOK_BASE_URL = 'https://chaos-e2e.collectiq.test';
    process.env.RECOVERY_WORKER_ENABLED = 'false';
    process.env.WEBHOOK_RECOVERY_ENABLED = 'true';
    process.env.COLLECTIQ_REQUIRE_TLS = 'false';
    process.env.TYPEORM_SYNC = 'true';
    process.env.TYPEORM_MIGRATIONS_RUN = 'false';
    process.env.RATE_LIMIT_ENABLED = 'false';

    chaosPayment = new ChaosPaymentAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(chaosPayment)
      .overrideProvider(TwilioTelephonyAdapter)
      .useValue(stubTelephonyAdapter)
      .overrideGuard(TwilioWebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    await seedTenantBasics(dataSource);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  /**
   * 1) Stripe webhook drives PROCESSING -> SUCCESS; duplicate event is deduped.
   */
  it('recovers when payment succeeds at provider but webhook is missing (no duplicate SUCCESS)', async () => {
    chaosPayment.reset();
    chaosPayment.retrieveStatuses = ['succeeded'];

    const paymentId = randomUUID();
    const gatewayId = `pi_chaos_missing_webhook_${paymentId}`;
    const approvalCorr = randomUUID();
    const log = dataSource.getRepository(StateTransitionLogEntity);
    const links = dataSource.getRepository(PaymentGatewayIntentLinkEntity);

    const t0 = new Date(Date.now() - 60_000);
    const t1 = new Date(Date.now() - 50_000);
    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId: paymentId,
        machine: MachineKind.PAYMENT,
        fromState: PaymentMachineState.ALTERNATE_METHOD,
        toState: PaymentMachineState.INITIATED,
        actor: 'chaos-seed',
        metadataJson: JSON.stringify({
          idempotencyKey: 'chaos-boot-1',
          amountCents: 2500,
          currency: 'usd',
          approvalCorrelationId: approvalCorr,
        }),
        occurredAt: t0,
      }),
    );
    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId: paymentId,
        machine: MachineKind.PAYMENT,
        fromState: PaymentMachineState.INITIATED,
        toState: PaymentMachineState.PROCESSING,
        actor: 'chaos-seed',
        metadataJson: null,
        occurredAt: t1,
      }),
    );
    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId: approvalCorr,
        machine: MachineKind.APPROVAL,
        fromState: ApprovalMachineState.REQUESTED,
        toState: ApprovalMachineState.APPROVED,
        actor: 'chaos-seed',
        metadataJson: null,
        occurredAt: new Date(t0.getTime() - 1000),
      }),
    );
    await links.save(
      links.create({
        tenantId: TENANT,
        paymentId,
        gatewayPaymentIntentId: gatewayId,
      }),
    );

    // Shared tenant across scenarios: clear stale idempotency rows so recovery is not a false SMEK replay.
    await dataSource.getRepository(IdempotencyKeyEntity).delete({ tenantId: TENANT });
    const stripeWebhooks = nest().get(StripeWebhookService);
    const eventId = `evt_chaos_${randomUUID()}`;

    await stripeWebhooks.handlePaymentIntentEvent({
      tenantId: TENANT,
      eventId,
      gatewayPaymentIntentId: gatewayId,
      providerStatus: 'succeeded',
      rawPayload: { id: eventId, type: 'payment_intent.succeeded' },
    });
    await stripeWebhooks.handlePaymentIntentEvent({
      tenantId: TENANT,
      eventId,
      gatewayPaymentIntentId: gatewayId,
      providerStatus: 'succeeded',
      rawPayload: { id: eventId, type: 'payment_intent.succeeded' },
    });

    const successRows = await log.count({
      where: {
        tenantId: TENANT,
        correlationId: paymentId,
        machine: MachineKind.PAYMENT,
        toState: PaymentMachineState.SUCCESS,
      },
    });
    expect(successRows).toBe(1);
  });

  /**
   * 2) Twilio retries the same voice status — second delivery is duplicate HTTP 200 without re-entering SMEK.
   */
  it('treats duplicate Twilio webhook as safe no-op (no double SMEK)', async () => {
    const correlationId = `chaos-call-dup-${randomUUID()}`;
    const log = dataSource.getRepository(StateTransitionLogEntity);
    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId,
        machine: MachineKind.CALL,
        fromState: CallMachineState.INITIATED,
        toState: CallMachineState.CONNECTED,
        actor: 'chaos-seed',
        metadataJson: null,
        occurredAt: new Date(),
      }),
    );

    const path = `/webhooks/telephony/twilio/voice/status?correlationId=${encodeURIComponent(correlationId)}`;
    const fullUrl = `${process.env.PUBLIC_WEBHOOK_BASE_URL}${path}`;
    const body: Record<string, string> = {
      CallStatus: 'queued',
      CallSid: 'CA_CHAOS_DUP',
      AccountSid: 'ACchaos_e2e',
    };
    const sig = getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, fullUrl, body);

    const server = nest().getHttpServer();
    await request(server).post(path).set('X-Twilio-Signature', sig).type('form').send(body).expect(200);
    await request(server).post(path).set('X-Twilio-Signature', sig).type('form').send(body).expect(200);
  });

  /**
   * 3) Process dies with no DATA rows — recovery infers NOT_STARTED and completes via SMEK (valid terminal progression).
   */
  it('recovers after crash mid-execution using ExecutionRecoveryService (DATA bootstrap)', async () => {
    const correlationId = `chaos-crash-${randomUUID()}`;
    const recovery = nest().get(ExecutionRecoveryService);
    const result = await recovery.recoverExecution(TENANT, correlationId, {
      inferDataNotStarted: true,
      inferSyncAfterPaymentSuccess: false,
    });
    expect(result.action).toBe('executed');
    expect(result.smekResult?.outcome).toBe(SMEK_OUTCOME.COMPLETED);

    const second = await recovery.recoverExecution(TENANT, correlationId, {
      inferDataNotStarted: true,
      inferSyncAfterPaymentSuccess: false,
    });
    expect(second.action).toBe('noop');
  });

  /**
   * 4) Payment gateway flakes then succeeds — resilience retries; single PROCESSING outcome.
   */
  it('survives adapter timeouts on createIntent without duplicate payment binding', async () => {
    chaosPayment.reset();
    chaosPayment.createIntentFailuresBeforeSuccess = 2;
    chaosPayment.retrieveStatuses = ['requires_payment_method'];

    const approvalCorr = randomUUID();
    const log = dataSource.getRepository(StateTransitionLogEntity);
    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId: approvalCorr,
        machine: MachineKind.APPROVAL,
        fromState: ApprovalMachineState.REQUESTED,
        toState: ApprovalMachineState.APPROVED,
        actor: 'chaos-seed',
        metadataJson: null,
        occurredAt: new Date(),
      }),
    );

    const paymentService = nest().get(PaymentService);
    const out = await paymentService.createPaymentIntent({
      tenantId: TENANT,
      idempotencyKey: `chaos-timeout-${randomUUID()}`,
      amountCents: 1000,
      currency: 'usd',
      approvalCorrelationId: approvalCorr,
    });

    expect(out.toState).toBe(PaymentMachineState.PROCESSING);
    expect(chaosPayment.createIntentCallCount).toBe(3);

    const linkCount = await dataSource.getRepository(PaymentGatewayIntentLinkEntity).count({
      where: { tenantId: TENANT, paymentId: out.paymentId },
    });
    expect(linkCount).toBe(1);
  });

  /**
   * 5) Approval not yet APPROVED — payment creation fails; after approval lands, payment reaches PROCESSING (no invalid PAYMENT SUCCESS).
   */
  it('blocks payment until approval is recorded (approval delay)', async () => {
    chaosPayment.reset();
    chaosPayment.retrieveStatuses = ['requires_payment_method'];

    const approvalCorr = `chaos-appr-delay-${randomUUID()}`;
    const log = dataSource.getRepository(StateTransitionLogEntity);
    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId: approvalCorr,
        machine: MachineKind.APPROVAL,
        fromState: ApprovalMachineState.REQUESTED,
        toState: ApprovalMachineState.PENDING,
        actor: 'chaos-seed',
        metadataJson: JSON.stringify({ escalationDeadlineAtIso: new Date(Date.now() + 86_400_000).toISOString() }),
        occurredAt: new Date(),
      }),
    );

    const paymentService = nest().get(PaymentService);
    const idem = `chaos-appr-delay-pay-${randomUUID()}`;
    await expect(
      paymentService.createPaymentIntent({
        tenantId: TENANT,
        idempotencyKey: idem,
        amountCents: 2000,
        currency: 'usd',
        approvalCorrelationId: approvalCorr,
      }),
    ).rejects.toThrow(/APPROVED/);

    await log.save(
      log.create({
        tenantId: TENANT,
        correlationId: approvalCorr,
        machine: MachineKind.APPROVAL,
        fromState: ApprovalMachineState.PENDING,
        toState: ApprovalMachineState.APPROVED,
        actor: 'chaos-seed',
        metadataJson: null,
        occurredAt: new Date(),
      }),
    );

    const out = await paymentService.createPaymentIntent({
      tenantId: TENANT,
      idempotencyKey: idem,
      amountCents: 2000,
      currency: 'usd',
      approvalCorrelationId: approvalCorr,
    });
    expect(out.toState).toBe(PaymentMachineState.PROCESSING);

    const successEarly = await log.count({
      where: {
        tenantId: TENANT,
        correlationId: out.paymentId,
        machine: MachineKind.PAYMENT,
        toState: PaymentMachineState.SUCCESS,
      },
    });
    expect(successEarly).toBe(0);
  });
});
