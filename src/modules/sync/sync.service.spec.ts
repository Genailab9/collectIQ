import { SMEK_OUTCOME } from '../../kernel/smek-kernel.dto';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { SyncMachineState } from '../../state-machine/definitions/sync-machine.definition';
import { SyncService } from './sync.service';

describe('SyncService', () => {
  const params = {
    tenantId: 't1',
    paymentId: 'pay_1',
    approvalCorrelationId: 'appr_1',
    idempotencyKey: 'idem-1',
    borrowerOptedOut: false,
  };

  function completedResult(phase: ExecutionLoopPhase) {
    return {
      outcome: SMEK_OUTCOME.COMPLETED,
      phase,
      tenantId: params.tenantId,
      correlationId: params.paymentId,
    };
  }

  it('runs strict payment->sync flow and remains idempotent on replay', async () => {
    const getLatestSyncToState = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SyncMachineState.IN_FLIGHT)
      .mockResolvedValueOnce(SyncMachineState.CASE_FINALIZED)
      .mockResolvedValueOnce(SyncMachineState.COMPLETED);
    const executeLoop = jest
      .fn()
      .mockResolvedValueOnce(completedResult(ExecutionLoopPhase.SYNC))
      .mockResolvedValueOnce({
        ...completedResult(ExecutionLoopPhase.SYNC),
        adapterResult: { caseStatus: 'FINALIZED' },
      })
      .mockResolvedValueOnce(completedResult(ExecutionLoopPhase.SYNC));
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: unknown) => x),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new SyncService(
      { executeLoop } as never,
      { getLatestSyncToState } as never,
      snapshots as never,
    );

    await svc.runPostPaymentSettlementSync(params);
    await svc.runPostPaymentSettlementSync(params);

    expect(executeLoop).toHaveBeenCalledTimes(3);
    expect(snapshots.save).toHaveBeenCalled();
    expect(snapshots.update).toHaveBeenCalledWith(
      { tenantId: params.tenantId, paymentId: params.paymentId },
      { syncCompletedLogged: true },
    );
  });
});
