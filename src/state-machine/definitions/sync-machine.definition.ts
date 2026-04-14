import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

/**
 * PRD v1.1 §6.3 — settlement sync as validated transitions + SMEK SYNC phase adapter.
 * Bootstrap mirrors PAYMENT (`ALTERNATE_METHOD → INITIATED`): internal first edge for a new sync correlationId.
 */
export const SyncMachineState = {
  NOT_STARTED: 'NOT_STARTED',
  IN_FLIGHT: 'IN_FLIGHT',
  /** Outbound sync adapter succeeded; case finalized before terminal completion (strict sync loop). */
  CASE_FINALIZED: 'CASE_FINALIZED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const { NOT_STARTED, IN_FLIGHT, CASE_FINALIZED, COMPLETED, FAILED } = SyncMachineState;

const states = new Set<string>(Object.values(SyncMachineState));

const terminalStates = new Set<string>([COMPLETED, FAILED]);

const transitions = new Map<string, ReadonlySet<string>>([
  [NOT_STARTED, new Set([IN_FLIGHT]) as ReadonlySet<string>],
  [IN_FLIGHT, new Set([CASE_FINALIZED, FAILED]) as ReadonlySet<string>],
  [CASE_FINALIZED, new Set([COMPLETED, FAILED]) as ReadonlySet<string>],
]);

export const syncMachineDefinition: MachineDefinition = {
  kind: MachineKind.SYNC,
  states,
  terminalStates,
  transitions,
};
