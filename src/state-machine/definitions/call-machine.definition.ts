import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

export const CallMachineState = {
  INITIATED: 'INITIATED',
  RINGING: 'RINGING',
  CONNECTED: 'CONNECTED',
  AUTHENTICATED: 'AUTHENTICATED',
  NEGOTIATING: 'NEGOTIATING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  /** PRD v1.1 §4.1 — retry scheduled after a recoverable failure (non-terminal). */
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const states = new Set<string>(Object.values(CallMachineState));

const terminalStates = new Set<string>([
  CallMachineState.COMPLETED,
  CallMachineState.FAILED,
]);

const retryable = CallMachineState.RETRY_SCHEDULED;

const transitions = new Map<string, ReadonlySet<string>>([
  [
    CallMachineState.INITIATED,
    new Set([CallMachineState.RINGING, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    CallMachineState.RINGING,
    new Set([CallMachineState.CONNECTED, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    CallMachineState.CONNECTED,
    new Set([CallMachineState.AUTHENTICATED, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    CallMachineState.AUTHENTICATED,
    new Set([CallMachineState.NEGOTIATING, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    CallMachineState.NEGOTIATING,
    new Set([CallMachineState.WAITING_APPROVAL, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    CallMachineState.WAITING_APPROVAL,
    new Set([CallMachineState.PAYMENT_PENDING, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    CallMachineState.PAYMENT_PENDING,
    new Set([CallMachineState.COMPLETED, CallMachineState.FAILED, retryable]) as ReadonlySet<string>,
  ],
  [
    retryable,
    new Set([CallMachineState.INITIATED]) as ReadonlySet<string>,
  ],
]);

export const callMachineDefinition: MachineDefinition = {
  kind: MachineKind.CALL,
  states,
  terminalStates,
  transitions,
};
