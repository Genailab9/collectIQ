import type { Repository } from 'typeorm';
import { WebhookEventEntity } from '../adapters/telephony/webhooks/entities/webhook-event.entity';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../state-machine/types/machine-kind';
import { ConfigService } from '@nestjs/config';
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

    const webhooks = {
      find: jest.fn().mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:01:30Z'),
          provider: 'twilio',
          externalDedupeKey: 'twilio:voice_status:CA1:in-progress:tenant-1:corr-1',
          rawPayload: '{"CallSid":"CA1","CallStatus":"in-progress"}',
          normalizedEvent: '{"kind":"twilio.voice.status","outcome":"COMPLETED"}',
          processed: true,
        },
      ]),
    } as unknown as Repository<WebhookEventEntity>;

    const cipher = {
      openPayloadJson: (s: string) => s,
    };

    const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;
    const metrics = { incTraceSummaryCacheHit: jest.fn(), incTraceSummaryCacheMiss: jest.fn() };
    const svc = new TraceExecutionService(
      transitions,
      audits,
      idem,
      webhooks,
      cipher as never,
      config,
      metrics as never,
    );
    const trace = await svc.traceExecution(' tenant-1 ', ' corr-1 ');

    expect(trace.tenantId).toBe('tenant-1');
    expect(trace.correlationId).toBe('corr-1');
    expect(trace.transitions).toHaveLength(1);
    expect(trace.adapterCalls).toHaveLength(1);
    expect(trace.webhookEvents).toHaveLength(2);
    expect(trace.webhookEvents.some((w) => w.stage === 'WEBHOOK_RECEIVED')).toBe(true);
    expect(trace.webhookEvents.some((w) => w.stage === 'WEBHOOK_PROCESSED')).toBe(true);
    expect(trace.errors.some((e) => e.source === 'idempotency_keys')).toBe(true);
  });
});
