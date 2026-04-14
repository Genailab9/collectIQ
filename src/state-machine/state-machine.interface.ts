import type { MachineKind } from './types/machine-kind';
import type { TransitionProposal } from './types/transition-proposal';

export interface StateMachineEngine {
  isEngineReady(): boolean;
  assertTransitionAllowed(proposal: TransitionProposal): void;
  recordValidatedTransition(proposal: TransitionProposal): Promise<void>;
  listRegisteredMachines(): MachineKind[];
}
