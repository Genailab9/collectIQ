import { RecoveryWorker } from './recovery.worker';
import { MachineKind } from '../state-machine/types/machine-kind';
import { DataMachineState } from '../state-machine/definitions/data-machine.definition';

function makeQbMock(getRawMany: jest.Mock) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany,
  };
  return { qb, repo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } };
}

describe('RecoveryWorker', () => {
  it('findStaleExecutionKeys maps raw rows to dates', async () => {
    const getRawMany = jest.fn().mockResolvedValue([
      {
        tenantId: 'tenant-a',
        correlationId: 'corr-1',
        lastOccurredAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    const { repo } = makeQbMock(getRawMany);
    const worker = new RecoveryWorker(
      repo as never,
      {} as never,
      { recoverMissingWebhooksSince: jest.fn() } as never,
      { get: jest.fn() } as never,
      { run: jest.fn((_t, fn: () => unknown) => fn()) } as never,
      { emit: jest.fn() } as never,
    );

    const rows = await worker.findStaleExecutionKeys(new Date('2025-01-01'), 10);
    expect(rows).toEqual([
      {
        tenantId: 'tenant-a',
        correlationId: 'corr-1',
        lastOccurredAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);
    expect(repo.createQueryBuilder).toHaveBeenCalledWith('t');
    expect(getRawMany).toHaveBeenCalled();
  });

  it('does not call recoverExecution when snapshot is terminal', async () => {
    const getRawMany = jest.fn().mockResolvedValue([
      {
        tenantId: 't1',
        correlationId: 'c1',
        lastOccurredAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    const { repo } = makeQbMock(getRawMany);
    const recoverExecution = jest.fn();
    const getExecutionSnapshot = jest.fn().mockResolvedValue({
      pending: { kind: 'none' },
      tenantId: 't1',
      correlationId: 'c1',
      transitionsAsc: [],
      states: { [MachineKind.DATA]: DataMachineState.COMPLETED },
      lastTransition: null,
      lastSuccessfulTransition: null,
    });
    const config = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'RECOVERY_WORKER_ENABLED') {
          return 'true';
        }
        if (key === 'RECOVERY_TIMEOUT_MINUTES') {
          return def ?? '5';
        }
        return def;
      }),
    };
    const webhookSweep = jest.fn().mockResolvedValue(undefined);
    const worker = new RecoveryWorker(
      repo as never,
      { getExecutionSnapshot, recoverExecution } as never,
      { recoverMissingWebhooksSince: webhookSweep } as never,
      config as never,
      { run: jest.fn((_t, fn: () => Promise<unknown>) => fn()) } as never,
      { emit: jest.fn() } as never,
    );

    await worker.sweepStaleExecutions();
    expect(recoverExecution).not.toHaveBeenCalled();
    expect(webhookSweep).toHaveBeenCalled();
  });

  it('skips recover when worker disabled', async () => {
    const getRawMany = jest.fn().mockResolvedValue([
      { tenantId: 't1', correlationId: 'c1', lastOccurredAt: '2020-01-01T00:00:00.000Z' },
    ]);
    const { repo } = makeQbMock(getRawMany);
    const recoverExecution = jest.fn();
    const webhookSweep = jest.fn();
    const config = {
      get: jest.fn((key: string) => (key === 'RECOVERY_WORKER_ENABLED' ? 'false' : '5')),
    };
    const worker = new RecoveryWorker(
      repo as never,
      { getExecutionSnapshot: jest.fn(), recoverExecution } as never,
      { recoverMissingWebhooksSince: webhookSweep } as never,
      config as never,
      { run: jest.fn() } as never,
      { emit: jest.fn() } as never,
    );

    await worker.sweepStaleExecutions();
    expect(recoverExecution).not.toHaveBeenCalled();
    expect(webhookSweep).not.toHaveBeenCalled();
    expect(getRawMany).not.toHaveBeenCalled();
  });
});
