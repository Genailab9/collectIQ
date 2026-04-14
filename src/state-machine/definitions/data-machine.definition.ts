import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

/** PRD v1.1 §6.2 — Data step as a validated transition (single hop; correlation = settlement case id). */
export const DataMachineState = {
  NOT_STARTED: 'NOT_STARTED',
  COMPLETED: 'COMPLETED',
} as const;

const { NOT_STARTED, COMPLETED } = DataMachineState;

const states = new Set<string>(Object.values(DataMachineState));

const terminalStates = new Set<string>([COMPLETED]);

const transitions = new Map<string, ReadonlySet<string>>([
  [NOT_STARTED, new Set([COMPLETED]) as ReadonlySet<string>],
]);

export const dataMachineDefinition: MachineDefinition = {
  kind: MachineKind.DATA,
  states,
  terminalStates,
  transitions,
};
