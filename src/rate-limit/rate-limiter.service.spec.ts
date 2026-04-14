import { ConfigService } from '@nestjs/config';
import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { MachineKind } from '../state-machine/types/machine-kind';
import type { SmekLoopCommand } from '../kernel/smek-kernel.dto';
import { RateLimiterService } from './rate-limiter.service';

function cfg(overrides: Record<string, string> = {}): ConfigService {
  const map: Record<string, string> = {
    RATE_LIMIT_ENABLED: 'true',
    RATE_LIMIT_CALLS_PER_MINUTE: '0',
    RATE_LIMIT_PAYMENTS_PER_SECOND: '0',
    ...overrides,
  };
  return {
    get: (k: string) => map[k],
  } as unknown as ConfigService;
}

function payCommand(tenantId: string): SmekLoopCommand {
  return {
    phase: ExecutionLoopPhase.PAY,
    transition: {
      tenantId,
      correlationId: 'p1',
      machine: MachineKind.PAYMENT,
      from: 'PROCESSING',
      to: 'SUCCESS',
      actor: 'test',
      metadata: {},
    },
    adapterEnvelope: null,
    complianceGate: {
      tenantId,
      correlationId: 'p1',
      executionPhase: ExecutionLoopPhase.PAY,
    },
  } as unknown as SmekLoopCommand;
}

describe('RateLimiterService', () => {
  it('no-ops when disabled', async () => {
    const svc = new RateLimiterService(cfg({ RATE_LIMIT_ENABLED: 'false' }));
    await svc.acquireBeforeSmek(payCommand('t1'));
  });

  it('no-ops when limits are zero (unlimited)', async () => {
    const svc = new RateLimiterService(cfg({}));
    await svc.acquireBeforeSmek(payCommand('t1'));
  });

  it('delays second PAY invocation when payments/sec is 1 (sliding 1s window)', async () => {
    const svc = new RateLimiterService(
      cfg({
        RATE_LIMIT_PAYMENTS_PER_SECOND: '1',
      }),
    );
    const cmd = payCommand('tenant-a');
    const t0 = Date.now();
    await svc.acquireBeforeSmek(cmd);
    await svc.acquireBeforeSmek(cmd);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});
