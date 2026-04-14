import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { SMEK_OUTCOME } from '../../kernel/smek-kernel.dto';
import { PaymentMachineState } from '../../state-machine/definitions/payment-machine.definition';
import {
  PaymentDuplicateInProgressError,
  PaymentIdempotencyRequiredError,
  PaymentStateConflictError,
} from './payment.errors';
import { PaymentService } from './payment.service';

function completedSmek(paymentId: string, tenantId = 'tenant-1') {
  return {
    outcome: SMEK_OUTCOME.COMPLETED,
    phase: ExecutionLoopPhase.PAY,
    tenantId,
    correlationId: paymentId,
    adapterResult: undefined as unknown,
  };
}

describe('PaymentService (PRD §7)', () => {
  const tenantId = 'tenant-1';
  const paymentId = 'pay-1';
  const gid = 'pi_test_123';

  it('rejects empty idempotency key on confirm', async () => {
    const svc = new PaymentService(
      { executeLoop: jest.fn() } as never,
      {
        getLatestPaymentToState: jest.fn().mockResolvedValue(PaymentMachineState.PROCESSING),
        getLatestGatewayPaymentIntentId: jest.fn().mockResolvedValue(gid),
        findPaymentIdByIdempotencyKey: jest.fn(),
        getBootstrapMetadataForPayment: jest.fn(),
      } as never,
      {} as never,
      { runPostPaymentSettlementSync: jest.fn() } as never,
      { findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) } as never,
      { incPaymentFailures: jest.fn() } as never,
    );

    await expect(
      svc.confirmPayment({
        tenantId,
        paymentId,
        gatewayPaymentIntentId: gid,
        idempotencyKey: '   ',
      }),
    ).rejects.toThrow(PaymentIdempotencyRequiredError);
  });

  it('returns SUCCESS and runs SYNC when already terminal SUCCESS', async () => {
    const smek = { executeLoop: jest.fn() };
    const sync = { runPostPaymentSettlementSync: jest.fn().mockResolvedValue(undefined) };
    const svc = new PaymentService(
      smek as never,
      {
        getLatestPaymentToState: jest.fn().mockResolvedValue(PaymentMachineState.SUCCESS),
        getLatestGatewayPaymentIntentId: jest.fn().mockResolvedValue(gid),
        findPaymentIdByIdempotencyKey: jest.fn(),
        getBootstrapMetadataForPayment: jest.fn().mockResolvedValue({
          idempotencyKey: 'boot',
          amountCents: 100,
          currency: 'usd',
          approvalCorrelationId: 'appr-1',
        }),
      } as never,
      {} as never,
      sync as never,
      { findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) } as never,
      { incPaymentFailures: jest.fn() } as never,
    );

    const r = await svc.confirmPayment({
      tenantId,
      paymentId,
      gatewayPaymentIntentId: gid,
      idempotencyKey: 'client-confirm-key',
    });
    expect(r).toEqual({ toState: PaymentMachineState.SUCCESS });
    expect(smek.executeLoop).not.toHaveBeenCalled();
    expect(sync.runPostPaymentSettlementSync).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate confirm while the first confirm is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });

    const smek = {
      executeLoop: jest.fn().mockImplementation(async () => {
        await gate;
        return completedSmek(paymentId, tenantId);
      }),
    };

    const transitions = {
      getLatestPaymentToState: jest.fn().mockResolvedValue(PaymentMachineState.PROCESSING),
      getLatestGatewayPaymentIntentId: jest.fn().mockResolvedValue(gid),
      findPaymentIdByIdempotencyKey: jest.fn(),
      getBootstrapMetadataForPayment: jest.fn().mockResolvedValue({
        idempotencyKey: 'boot',
        amountCents: 100,
        currency: 'usd',
        approvalCorrelationId: 'appr-1',
      }),
    };

    const svc = new PaymentService(
      smek as never,
      transitions as never,
      {} as never,
      { runPostPaymentSettlementSync: jest.fn().mockResolvedValue(undefined) } as never,
      { findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) } as never,
      { incPaymentFailures: jest.fn() } as never,
    );

    const first = svc.confirmPayment({
      tenantId,
      paymentId,
      gatewayPaymentIntentId: gid,
      idempotencyKey: 'ik-first',
    });

    await Promise.resolve();

    await expect(
      svc.confirmPayment({
        tenantId,
        paymentId,
        gatewayPaymentIntentId: gid,
        idempotencyKey: 'ik-second',
      }),
    ).rejects.toThrow(PaymentDuplicateInProgressError);

    release();
    await first;
    expect(smek.executeLoop).toHaveBeenCalledTimes(1);
  });

  it('rejects client gateway id that does not match persisted binding', async () => {
    const svc = new PaymentService(
      { executeLoop: jest.fn() } as never,
      {
        getLatestPaymentToState: jest.fn().mockResolvedValue(PaymentMachineState.PROCESSING),
        getLatestGatewayPaymentIntentId: jest.fn().mockResolvedValue(gid),
        findPaymentIdByIdempotencyKey: jest.fn(),
        getBootstrapMetadataForPayment: jest.fn(),
      } as never,
      {} as never,
      { runPostPaymentSettlementSync: jest.fn() } as never,
      { findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) } as never,
      { incPaymentFailures: jest.fn() } as never,
    );

    await expect(
      svc.confirmPayment({
        tenantId,
        paymentId,
        gatewayPaymentIntentId: 'pi_wrong',
        idempotencyKey: 'ik',
      }),
    ).rejects.toThrow(PaymentStateConflictError);
  });
});
