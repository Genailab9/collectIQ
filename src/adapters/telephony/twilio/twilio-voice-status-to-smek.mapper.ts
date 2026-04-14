import type { ComplianceGateInput } from '../../../compliance/compliance.types';
import { ExecutionLoopPhase } from '../../../contracts/execution-loop-phase';
import type { SmekLoopCommand, TelephonyIngressContext } from '../../../kernel/smek-kernel.dto';
import { CallMachineState } from '../../../state-machine/definitions/call-machine.definition';
import { MachineKind } from '../../../state-machine/types/machine-kind';

export class TwilioVoiceStatusToSmekMapper {
  /**
   * Builds a SMEK loop command for a Twilio voice status callback.
   * `resolvedFromState` MUST come from the transition log (or INITIATED when no CALL rows yet); never from the webhook URL (PRD §9.3).
   * Returns null when no mapped state change is implied (including unknown statuses).
   */
  static tryBuildCommand(params: {
    readonly tenantId: string;
    readonly correlationId: string;
    /** Server-resolved current CALL state (append-only log), never client-supplied. */
    readonly resolvedFromState: string;
    readonly callStatus: string;
    readonly borrowerOptedOut?: boolean;
    readonly idempotency?: { readonly key: string; readonly step: string };
  }): SmekLoopCommand | null {
    const toState = mapTwilioCallStatusToCallMachineState(params.callStatus);
    if (!toState) {
      return null;
    }
    if (toState === params.resolvedFromState) {
      return null;
    }

    const telephonyIngress: TelephonyIngressContext = { source: 'TWILIO_VOICE_STATUS' };

    const complianceGate: ComplianceGateInput = {
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      executionPhase: ExecutionLoopPhase.CALL,
      borrowerOptedOut: params.borrowerOptedOut,
    };

    return {
      phase: ExecutionLoopPhase.CALL,
      transition: {
        tenantId: params.tenantId,
        correlationId: params.correlationId,
        machine: MachineKind.CALL,
        from: params.resolvedFromState,
        to: toState,
      },
      adapterEnvelope: null,
      complianceGate,
      telephonyIngress,
      ...(params.idempotency ? { idempotency: params.idempotency } : {}),
    };
  }
}

function mapTwilioCallStatusToCallMachineState(status: string): string | null {
  const s = status.trim().toLowerCase();
  switch (s) {
    case 'queued':
    case 'initiated':
      return CallMachineState.INITIATED;
    case 'ringing':
      return CallMachineState.RINGING;
    case 'in-progress':
      return CallMachineState.CONNECTED;
    case 'completed':
      return CallMachineState.COMPLETED;
    case 'busy':
    case 'failed':
    case 'no-answer':
    case 'canceled':
      return CallMachineState.FAILED;
    default:
      return null;
  }
}
