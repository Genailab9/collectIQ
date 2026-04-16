import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

export const AccountMachineState = {
  ACTIVE: 'ACTIVE',
  IN_COLLECTIONS: 'IN_COLLECTIONS',
  NEGOTIATING: 'NEGOTIATING',
  SETTLEMENT_ACCEPTED: 'SETTLEMENT_ACCEPTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
} as const;

const states = new Set<string>(Object.values(AccountMachineState));
const terminalStates = new Set<string>([AccountMachineState.CLOSED, AccountMachineState.FAILED]);

const transitions = new Map<string, ReadonlySet<string>>([
  [
    AccountMachineState.ACTIVE,
    new Set([AccountMachineState.IN_COLLECTIONS, AccountMachineState.FAILED]) as ReadonlySet<string>,
  ],
  [
    AccountMachineState.IN_COLLECTIONS,
    new Set([AccountMachineState.NEGOTIATING, AccountMachineState.FAILED]) as ReadonlySet<string>,
  ],
  [
    AccountMachineState.NEGOTIATING,
    new Set([AccountMachineState.SETTLEMENT_ACCEPTED, AccountMachineState.FAILED]) as ReadonlySet<string>,
  ],
  [
    AccountMachineState.SETTLEMENT_ACCEPTED,
    new Set([AccountMachineState.PAYMENT_PENDING, AccountMachineState.FAILED]) as ReadonlySet<string>,
  ],
  [
    AccountMachineState.PAYMENT_PENDING,
    new Set([AccountMachineState.PAID, AccountMachineState.FAILED]) as ReadonlySet<string>,
  ],
  [
    AccountMachineState.PAID,
    new Set([AccountMachineState.CLOSED, AccountMachineState.FAILED]) as ReadonlySet<string>,
  ],
]);

export const accountMachineDefinition: MachineDefinition = {
  kind: MachineKind.ACCOUNT,
  states,
  terminalStates,
  transitions,
};

