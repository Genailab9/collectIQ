import type { MachineKind } from './machine-kind';

export interface TransitionProposal {
  tenantId: string;
  correlationId: string;
  machine: MachineKind;
  from: string;
  to: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}
