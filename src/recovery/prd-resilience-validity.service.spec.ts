import { ConfigService } from '@nestjs/config';
import { ResilienceCircuitOpenError } from '../common/resilience/resilience.errors';
import { PrdResilienceValidityService } from './prd-resilience-validity.service';

function qbSingle<T>(row: T | null) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(row),
  };
}

function qbMany<T>(rows: T[]) {
  return {
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

function qbCount(n: number) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(n),
  };
}

describe('PrdResilienceValidityService', () => {
  it('returns PASS when all checks pass', async () => {
    const transitions = { createQueryBuilder: jest.fn().mockReturnValue(qbSingle(null)) };
    const idempotencyRows = {
      createQueryBuilder: jest.fn().mockReturnValue(qbCount(0)),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
    };
    const paymentLinks = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(qbMany([]))
        .mockReturnValueOnce(qbMany([])),
    };
    const webhookEvents = { createQueryBuilder: jest.fn().mockReturnValue(qbMany([])) };
    const recovery = { getExecutionSnapshot: jest.fn() };
    let probeCalls = 0;
    const resilience = {
      executeWithRetry: jest.fn().mockImplementation(async () => {
        probeCalls += 1;
        if (probeCalls < 3) {
          throw new Error('probe-fail');
        }
        throw new ResilienceCircuitOpenError('k', Date.now() + 1000);
      }),
    };
    const config = {
      get: (k: string) => (k === 'RESILIENCE_FAILURE_THRESHOLD' ? '2' : undefined),
    } as ConfigService;

    const svc = new PrdResilienceValidityService(
      transitions as never,
      idempotencyRows as never,
      paymentLinks as never,
      webhookEvents as never,
      recovery as never,
      resilience as never,
      config,
    );

    const out = await svc.runProductionGate({ actor: 'system' });
    expect(out.result).toBe('PASS');
    expect(out.checks.every((c) => c.status === 'PASS')).toBe(true);
  });

  it('returns FAIL when duplicate payment bindings exist', async () => {
    const transitions = { createQueryBuilder: jest.fn().mockReturnValue(qbSingle(null)) };
    const idempotencyRows = { count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]) };
    (idempotencyRows as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest
      .fn()
      .mockReturnValue(qbCount(0));
    const paymentLinks = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(qbMany([{ cnt: '2' }]))
        .mockReturnValueOnce(qbMany([])),
    };
    const webhookEvents = { createQueryBuilder: jest.fn().mockReturnValue(qbMany([])) };
    const recovery = { getExecutionSnapshot: jest.fn() };
    const resilience = {
      executeWithRetry: jest
        .fn()
        .mockRejectedValue(new ResilienceCircuitOpenError('k', Date.now() + 1000)),
    };
    const config = { get: () => '1' } as unknown as ConfigService;

    const svc = new PrdResilienceValidityService(
      transitions as never,
      idempotencyRows as never,
      paymentLinks as never,
      webhookEvents as never,
      recovery as never,
      resilience as never,
      config,
    );

    const out = await svc.runProductionGate({ actor: 'system' });
    expect(out.result).toBe('FAIL');
    expect(out.checks.find((c) => c.name === 'NO_DUPLICATE_PAYMENTS')?.status).toBe('FAIL');
  });
});
