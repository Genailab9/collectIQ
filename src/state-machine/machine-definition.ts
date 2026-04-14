import type { MachineKind } from './types/machine-kind';

export interface MachineDefinition {
  readonly kind: MachineKind;
  readonly states: ReadonlySet<string>;
  readonly terminalStates: ReadonlySet<string>;
  /** Directed edges: from -> allowed to-states */
  readonly transitions: ReadonlyMap<string, ReadonlySet<string>>;
}
