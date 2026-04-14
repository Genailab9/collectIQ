import type { MachineKind } from './types/machine-kind';

export class TransitionProposalDto {
  tenantId!: string;
  correlationId!: string;
  machine!: MachineKind;
  from!: string;
  to!: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}
