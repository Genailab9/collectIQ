import { BadRequestException, Injectable } from '@nestjs/common';
import { CallTransitionQueryService } from '../../adapters/telephony/call-transition-query.service';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { AiCommandKind } from '../../contracts/ai-command-kind';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { requireSmekCompleted } from '../../kernel/smek-loop-result.guard';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { CallMachineState } from '../../state-machine/definitions/call-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';

/**
 * PRD v1.1 §6.2 — thin HTTP facades; every mutation is `SmekKernelService.executeLoop` (compliance → validate → log → adapters).
 */
@Injectable()
export class SettlementExecutionService {
  constructor(
    private readonly smekKernel: SmekKernelService,
    private readonly callTransitions: CallTransitionQueryService,
  ) {}

  async authenticateCall(params: {
    tenantId: string;
    correlationId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const latest = await this.latestCallOrThrow(params.tenantId, params.correlationId);
    if (latest !== CallMachineState.CONNECTED) {
      throw new BadRequestException(
        `Cannot authenticate: latest CALL state is "${String(latest)}" (expected CONNECTED).`,
      );
    }
    requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.AUTHENTICATE,
        transition: {
          tenantId: params.tenantId.trim(),
          correlationId: params.correlationId.trim(),
          machine: MachineKind.CALL,
          from: CallMachineState.CONNECTED,
          to: CallMachineState.AUTHENTICATED,
          actor: 'settlement-execution',
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId: params.tenantId.trim(),
          correlationId: params.correlationId.trim(),
          executionPhase: ExecutionLoopPhase.AUTHENTICATE,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        telephonyIngress: { source: 'INTERNAL_AUTH_CHECKPOINT' },
        idempotency: {
          key: params.idempotencyKey.trim(),
          step: IdempotencyStep.ExecutionCallAuthenticate,
        },
      }),
      (m) => new BadRequestException(m),
    );
  }

  async negotiate(params: {
    tenantId: string;
    correlationId: string;
    conversationTranscript: string;
    accountFacts?: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<unknown> {
    const latest = await this.latestCallOrThrow(params.tenantId, params.correlationId);
    if (latest !== CallMachineState.AUTHENTICATED) {
      throw new BadRequestException(
        `Cannot negotiate: latest CALL state is "${String(latest)}" (expected AUTHENTICATED).`,
      );
    }
    const transcript = params.conversationTranscript.trim();
    if (!transcript) {
      throw new BadRequestException('conversationTranscript is required.');
    }
    const result = requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.NEGOTIATE,
        transition: {
          tenantId: params.tenantId.trim(),
          correlationId: params.correlationId.trim(),
          machine: MachineKind.CALL,
          from: CallMachineState.AUTHENTICATED,
          to: CallMachineState.NEGOTIATING,
          actor: 'settlement-execution',
        },
        adapterEnvelope: {
          kind: AiCommandKind.NegotiationSuggest,
          body: {
            tenantId: params.tenantId.trim(),
            correlationId: params.correlationId.trim(),
            conversationTranscript: transcript,
            accountFacts: params.accountFacts?.trim(),
          },
        },
        complianceGate: {
          tenantId: params.tenantId.trim(),
          correlationId: params.correlationId.trim(),
          executionPhase: ExecutionLoopPhase.NEGOTIATE,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        idempotency: {
          key: params.idempotencyKey.trim(),
          step: IdempotencyStep.ExecutionCallNegotiate,
        },
      }),
      (m) => new BadRequestException(m),
    );
    return result.adapterResult;
  }

  async submitCallForApproval(params: {
    tenantId: string;
    correlationId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const latest = await this.latestCallOrThrow(params.tenantId, params.correlationId);
    if (latest !== CallMachineState.NEGOTIATING) {
      throw new BadRequestException(
        `Cannot submit for approval: latest CALL state is "${String(latest)}" (expected NEGOTIATING).`,
      );
    }
    requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.CALL,
        transition: {
          tenantId: params.tenantId.trim(),
          correlationId: params.correlationId.trim(),
          machine: MachineKind.CALL,
          from: CallMachineState.NEGOTIATING,
          to: CallMachineState.WAITING_APPROVAL,
          actor: 'settlement-execution',
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId: params.tenantId.trim(),
          correlationId: params.correlationId.trim(),
          executionPhase: ExecutionLoopPhase.CALL,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        telephonyIngress: { source: 'INTERNAL_NEGOTIATION_COMPLETE' },
        idempotency: {
          key: params.idempotencyKey.trim(),
          step: IdempotencyStep.ExecutionCallSubmitForApproval,
        },
      }),
      (m) => new BadRequestException(m),
    );
  }

  private async latestCallOrThrow(tenantId: string, correlationId: string): Promise<string | null> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    if (!t || !c) {
      throw new BadRequestException('tenantId and correlationId are required.');
    }
    return this.callTransitions.getLatestCallToState(t, c);
  }
}
