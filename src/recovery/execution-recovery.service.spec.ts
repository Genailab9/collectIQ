import { SMEK_OUTCOME } from '../kernel/smek-kernel.dto';
import { IdempotencyStep } from '../contracts/idempotency-step';
import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { approvalMachineDefinition } from '../state-machine/definitions/approval-machine.definition';
import { callMachineDefinition } from '../state-machine/definitions/call-machine.definition';
import { dataMachineDefinition } from '../state-machine/definitions/data-machine.definition';
import { DataMachineState } from '../state-machine/definitions/data-machine.definition';
import { paymentMachineDefinition } from '../state-machine/definitions/payment-machine.definition';
import { PaymentMachineState } from '../state-machine/definitions/payment-machine.definition';
import { syncMachineDefinition } from '../state-machine/definitions/sync-machine.definition';
import { SyncMachineState } from '../state-machine/definitions/sync-machine.definition';
import type { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import type { MachineRegistryService } from '../state-machine/machine-registry.service';
import { MachineKind } from '../state-machine/types/machine-kind';
import type { SmekKernelService } from '../kernel/smek-kernel.service';
import type { PaymentTransitionQueryService } from '../modules/payment/payment-transition-query.service';
import { ExecutionRecoveryService } from './execution-recovery.service';

function makeQueryBuilderMock(rows: StateTransitionLogEntity[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb,
  };
}

function registryStub(): MachineRegistryService {
  const defs = new Map<MachineKind, (typeof dataMachineDefinition)>([
    [MachineKind.DATA, dataMachineDefinition],
    [MachineKind.CALL, callMachineDefinition],
    [MachineKind.APPROVAL, approvalMachineDefinition],
    [MachineKind.PAYMENT, paymentMachineDefinition],
    [MachineKind.SYNC, syncMachineDefinition],
  ]);
  return {
    getDefinition: (k: MachineKind) => {
      const d = defs.get(k);
      if (!d) {
        throw new Error(`missing ${k}`);
      }
      return d;
    },
  } as unknown as MachineRegistryService;
}

function row(p: Partial<StateTransitionLogEntity> & Pick<StateTransitionLogEntity, 'id'>): StateTransitionLogEntity {
  return {
    tenantId: 't1',
    correlationId: 'c1',
    machine: MachineKind.DATA,
    fromState: DataMachineState.NOT_STARTED,
    toState: DataMachineState.COMPLETED,
    actor: 'test',
    metadataJson: null,
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    ...p,
  } as StateTransitionLogEntity;
}

describe('ExecutionRecoveryService', () => {
  const tenantId = 't1';
  const correlationId = 'case-1';

  it('partial execution recovery: infers DATA NOT_STARTED and invokes SMEK with deterministic idempotency', async () => {
    const repo = makeQueryBuilderMock([]);
    const smekKernel = {
      executeLoop: jest.fn().mockResolvedValue({
        outcome: SMEK_OUTCOME.COMPLETED,
        phase: ExecutionLoopPhase.DATA,
        tenantId,
        correlationId,
        adapterResult: undefined,
      }),
    } as unknown as jest.Mocked<SmekKernelService>;
    const paymentTransitions = {
      getLatestPaymentToState: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PaymentTransitionQueryService>;

    const svc = new ExecutionRecoveryService(
      repo as never,
      registryStub(),
      smekKernel,
      paymentTransitions,
      { emit: jest.fn() } as never,
    );

    const result = await svc.recoverExecution(tenantId, correlationId, {
      inferDataNotStarted: true,
      inferSyncAfterPaymentSuccess: false,
    });

    expect(result.action).toBe('executed');
    expect(smekKernel.executeLoop).toHaveBeenCalledTimes(1);
    const cmd = smekKernel.executeLoop.mock.calls[0]![0]!;
    expect(cmd.phase).toBe(ExecutionLoopPhase.DATA);
    expect(cmd.idempotency?.key).toBe(
      `recovery:v1:${tenantId}:${correlationId}:DATA:${DataMachineState.NOT_STARTED}->${DataMachineState.COMPLETED}`,
    );
    expect(cmd.idempotency?.step).toBe(IdempotencyStep.RecoveryDataComplete);
  });

  it('full replay: repeated recovery attempts use identical SMEK idempotency when the log view is unchanged', async () => {
    const logRows: StateTransitionLogEntity[] = [];
    const repo = makeQueryBuilderMock(logRows);
    const smekKernel = {
      executeLoop: jest.fn().mockResolvedValue({
        outcome: SMEK_OUTCOME.COMPLETED,
        phase: ExecutionLoopPhase.DATA,
        tenantId,
        correlationId,
        adapterResult: undefined,
      }),
    } as unknown as jest.Mocked<SmekKernelService>;
    const paymentTransitions = {
      getLatestPaymentToState: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PaymentTransitionQueryService>;

    const svc = new ExecutionRecoveryService(
      repo as never,
      registryStub(),
      smekKernel,
      paymentTransitions,
      { emit: jest.fn() } as never,
    );

    const opts = { inferDataNotStarted: true, inferSyncAfterPaymentSuccess: false };
    await svc.recoverExecution(tenantId, correlationId, opts);
    await svc.recoverExecution(tenantId, correlationId, opts);

    expect(smekKernel.executeLoop).toHaveBeenCalledTimes(2);
    const first = smekKernel.executeLoop.mock.calls[0]![0]!.idempotency;
    const second = smekKernel.executeLoop.mock.calls[1]![0]!.idempotency;
    expect(first).toEqual(second);
  });

  it('lastSuccessfulTransition skips terminal FAILED rows', async () => {
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-01T00:01:00Z');
    const logRows = [
      row({
        id: 'ok',
        machine: MachineKind.SYNC,
        correlationId: 'pay-x',
        fromState: SyncMachineState.IN_FLIGHT,
        toState: SyncMachineState.CASE_FINALIZED,
        occurredAt: t1,
        metadataJson: null,
      }),
      row({
        id: 'bad',
        machine: MachineKind.SYNC,
        correlationId: 'pay-x',
        fromState: SyncMachineState.CASE_FINALIZED,
        toState: SyncMachineState.FAILED,
        occurredAt: t2,
        metadataJson: null,
      }),
    ];
    const repo = makeQueryBuilderMock(logRows);
    const svc = new ExecutionRecoveryService(
      repo as never,
      registryStub(),
      { executeLoop: jest.fn() } as unknown as SmekKernelService,
      { getLatestPaymentToState: jest.fn().mockResolvedValue(null) } as unknown as PaymentTransitionQueryService,
      { emit: jest.fn() } as never,
    );
    const snap = await svc.getExecutionSnapshot(tenantId, 'pay-x');
    expect(snap.lastTransition?.id).toBe('bad');
    expect(snap.lastSuccessfulTransition?.id).toBe('ok');
  });

  it('getExecutionSnapshot is deterministic for SYNC partial state with sorted multi-target edges', async () => {
    const paymentId = 'pay-1';
    const approvalId = 'appr-1';
    const clientKey = 'idem-client-1';
    const logRows = [
      row({
        id: 'p1',
        correlationId: paymentId,
        machine: MachineKind.PAYMENT,
        fromState: PaymentMachineState.ALTERNATE_METHOD,
        toState: PaymentMachineState.SUCCESS,
        metadataJson: null,
      }),
      row({
        id: 's1',
        correlationId: paymentId,
        machine: MachineKind.SYNC,
        fromState: SyncMachineState.NOT_STARTED,
        toState: SyncMachineState.IN_FLIGHT,
        metadataJson: JSON.stringify({
          trigger: 'post_payment_success',
          idempotencyKey: clientKey,
        }),
      }),
    ];
    const repo = makeQueryBuilderMock(logRows);
    const smekKernel = { executeLoop: jest.fn() } as unknown as jest.Mocked<SmekKernelService>;
    const paymentTransitions = {
      getLatestPaymentToState: jest.fn().mockResolvedValue(PaymentMachineState.SUCCESS),
    } as unknown as jest.Mocked<PaymentTransitionQueryService>;

    const svc = new ExecutionRecoveryService(
      repo as never,
      registryStub(),
      smekKernel,
      paymentTransitions,
      { emit: jest.fn() } as never,
    );

    const a = await svc.getExecutionSnapshot(tenantId, paymentId);
    const b = await svc.getExecutionSnapshot(tenantId, paymentId);
    expect(a).toEqual(b);
    expect(a.states[MachineKind.SYNC]).toBe(SyncMachineState.IN_FLIGHT);
    expect(a.pending.kind).toBe('ready');
    if (a.pending.kind === 'ready') {
      expect(a.pending.from).toBe(SyncMachineState.IN_FLIGHT);
      expect(a.pending.to).toBe(SyncMachineState.CASE_FINALIZED);
      expect(a.pending.idempotency.key).toBe(clientKey);
    }
    expect(a.lastSuccessfulTransition?.id).toBe('s1');
  });
});
