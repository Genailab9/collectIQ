import type { Repository } from 'typeorm';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../state-machine/types/machine-kind';
import { TraceExecutionService } from './trace-execution.service';

describe('TraceExecutionService', () => {
  it('traceExecution aggregates transitions, audits, and failed idempotency rows', async () => {
    const transitions = {
      find: jest.fn().mockResolvedValue([
        {
          occurredAt: new Date('2026-01-01T00:00:00Z'),
          machine: MachineKind.DATA,
          fromState: 'NOT_STARTED',
          toState: 'COMPLETED',
          actor: 'x',
          metadataJson: null,
        },
      ]),
    } as unknown as Repository<StateTransitionLogEntity>;

    const audits = {
      find: jest.fn().mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:01:00Z'),
          kind: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterResult,
          executionPhase: 'PAY',
          payloadJson: '{"adapterResult":{"status":"ok"}}',
        },
      ]),
    } as unknown as Repository<SmekOrchestrationAuditEntity>;

    const idem = {
      find: jest.fn().mockResolvedValue([
        {
          updatedAt: new Date('2026-01-01T00:02:00Z'),
          step: 'pay.confirm',
          idempotencyKey: 'ik-1',
        },
      ]),
    } as unknown as Repository<IdempotencyKeyEntity>;

    const cipher = {
      openPayloadJson: (s: string) => s,
    };

    const svc = new TraceExecutionService(transitions, audits, idem, cipher as never);
    const trace = await svc.traceExecution(' tenant-1 ', ' corr-1 ');

    expect(trace.tenantId).toBe('tenant-1');
    expect(trace.correlationId).toBe('corr-1');
    expect(trace.transitions).toHaveLength(1);
    expect(trace.adapterCalls).toHaveLength(1);
    expect(trace.errors.some((e) => e.source === 'idempotency_keys')).toBe(true);
  });
});
