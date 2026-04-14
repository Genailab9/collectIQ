import type { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import type { MachineKind } from '../state-machine/types/machine-kind';

/**
 * Gate input supplied by callers, extended by SMEK with proposed transition facts before evaluation.
 */
export interface ComplianceGateInput {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly executionPhase: ExecutionLoopPhase;
  readonly borrowerOptedOut?: boolean;
  /** Optional context only; PRD §11.1 call-window enforcement uses `Asia/Karachi` (PKT), not this field. */
  readonly borrowerLocalTimezone?: string;

  /** Set by SMEK — do not trust client-supplied values for enforcement. */
  readonly proposedMachine?: MachineKind;
  readonly proposedFrom?: string;
  readonly proposedTo?: string;
}
