import { ForbiddenException } from '@nestjs/common';
import { ExecutionLoopPhase } from '../../../contracts/execution-loop-phase';
import { SMEK_OUTCOME } from '../../../kernel/smek-kernel.dto';
import {
  CallMachineState,
  callMachineDefinition,
} from '../../../state-machine/definitions/call-machine.definition';
import { MachineKind } from '../../../state-machine/types/machine-kind';
import type { MachineRegistryService } from '../../../state-machine/machine-registry.service';
import { IdempotencyStep } from '../../../contracts/idempotency-step';
import { TwilioWebhookService, webhookEventIdempotencyKey } from './twilio-webhook.service';

describe('TwilioWebhookService (PRD §6)', () => {
  it('exposes stable webhook_event idempotency key', () => {
    expect(webhookEventIdempotencyKey('uuid-here')).toBe('webhook_event:uuid-here');
  });

  it('returns without SMEK when webhook is duplicate (Twilio retry)', async () => {
    const smek = { executeLoop: jest.fn() };
    const webhookEvents = {
      beginIngest: jest.fn().mockResolvedValue({
        mode: 'duplicate',
        event: { id: 'evt-dup', processed: true },
      }),
      markProcessed: jest.fn(),
    };
    const callTransitions = { getLatestCallToState: jest.fn() };

    const svc = new TwilioWebhookService(
      webhookEvents as never,
      callTransitions as never,
      registryStub(),
      smek as never,
      { run: (_t: string, fn: () => Promise<void>) => fn() } as never,
      { resolveTenantIdForCorrelation: jest.fn().mockResolvedValue('tenant-1') } as never,
    );

    await svc.handleVoiceStatus({
      body: { CallStatus: 'completed', CallSid: 'CA123' },
      correlationId: 'corr-1',
    });

    expect(smek.executeLoop).not.toHaveBeenCalled();
    expect(webhookEvents.markProcessed).not.toHaveBeenCalled();
    expect(callTransitions.getLatestCallToState).not.toHaveBeenCalled();
  });

  it('ignores out-of-order / disallowed CALL transition and marks anomaly', async () => {
    const smek = { executeLoop: jest.fn() };
    const webhookEvents = {
      beginIngest: jest.fn().mockResolvedValue({
        mode: 'created',
        event: { id: 'evt-new', processed: false },
      }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
    };
    const callTransitions = {
      getLatestCallToState: jest.fn().mockResolvedValue(CallMachineState.CONNECTED),
    };

    const svc = new TwilioWebhookService(
      webhookEvents as never,
      callTransitions as never,
      registryStub(),
      smek as never,
      { run: (_t: string, fn: () => Promise<void>) => fn() } as never,
      { resolveTenantIdForCorrelation: jest.fn().mockResolvedValue('tenant-1') } as never,
    );

    await svc.handleVoiceStatus({
      body: { CallStatus: 'queued', CallSid: 'CA999' },
      correlationId: 'corr-2',
    });

    expect(smek.executeLoop).not.toHaveBeenCalled();
    expect(webhookEvents.markProcessed).toHaveBeenCalledWith(
      'tenant-1',
      'evt-new',
      expect.objectContaining({ outcome: 'IGNORED_DISALLOWED_TRANSITION' }),
    );
  });

  it('invokes SMEK when transition is allowed', async () => {
    const smek = {
      executeLoop: jest.fn().mockResolvedValue({
        outcome: SMEK_OUTCOME.COMPLETED,
        phase: ExecutionLoopPhase.CALL,
        tenantId: 'tenant-1',
        correlationId: 'corr-3',
        adapterResult: undefined,
      }),
    };
    const webhookEvents = {
      beginIngest: jest.fn().mockResolvedValue({
        mode: 'created',
        event: { id: 'evt-ok', processed: false },
      }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
    };
    const callTransitions = {
      getLatestCallToState: jest.fn().mockResolvedValue(CallMachineState.INITIATED),
    };

    const svc = new TwilioWebhookService(
      webhookEvents as never,
      callTransitions as never,
      registryStub(),
      smek as never,
      { run: (_t: string, fn: () => Promise<void>) => fn() } as never,
      { resolveTenantIdForCorrelation: jest.fn().mockResolvedValue('tenant-1') } as never,
    );

    await svc.handleVoiceStatus({
      body: { CallStatus: 'ringing', CallSid: 'CAx' },
      correlationId: 'corr-3',
    });

    expect(smek.executeLoop).toHaveBeenCalledTimes(1);
    const cmd = smek.executeLoop.mock.calls[0]![0]!;
    expect(cmd.idempotency?.key).toBe(webhookEventIdempotencyKey('evt-ok'));
    expect(webhookEvents.markProcessed).toHaveBeenCalled();
  });

  it('executeRecoveryVoiceStatus uses WebhookRecoveryPoll idempotency step', async () => {
    const smek = {
      executeLoop: jest.fn().mockResolvedValue({
        outcome: SMEK_OUTCOME.COMPLETED,
        phase: ExecutionLoopPhase.CALL,
        tenantId: 'tenant-1',
        correlationId: 'corr-3',
        adapterResult: undefined,
      }),
    };
    const svc = new TwilioWebhookService(
      {} as never,
      {
        getLatestCallToState: jest.fn().mockResolvedValue(CallMachineState.INITIATED),
      } as never,
      registryStub(),
      smek as never,
      { run: jest.fn() } as never,
      { resolveTenantIdForCorrelation: jest.fn() } as never,
    );

    const out = await svc.executeRecoveryVoiceStatus({
      tenantId: 'tenant-1',
      correlationId: 'corr-3',
      providerCallStatus: 'ringing',
      idempotencyKey: 'recovery:twilio_voice:tenant-1:corr-3:ringing',
    });
    expect(out.kind).toBe('applied');
    expect(smek.executeLoop.mock.calls[0]![0]!.idempotency?.step).toBe(IdempotencyStep.WebhookRecoveryPoll);
  });

  it('rejects unknown correlation before persistence', async () => {
    const svc = new TwilioWebhookService(
      {} as never,
      {} as never,
      registryStub(),
      { executeLoop: jest.fn() } as never,
      { run: jest.fn() } as never,
      { resolveTenantIdForCorrelation: jest.fn().mockResolvedValue(null) } as never,
    );

    await expect(
      svc.handleVoiceStatus({
        body: { CallStatus: 'ringing' },
        correlationId: 'unknown',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

function registryStub(): MachineRegistryService {
  return {
    getDefinition: (k: MachineKind) => {
      if (k === MachineKind.CALL) {
        return callMachineDefinition;
      }
      throw new Error(`unexpected ${k}`);
    },
  } as unknown as MachineRegistryService;
}
