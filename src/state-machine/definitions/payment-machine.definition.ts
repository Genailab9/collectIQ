import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

/** PRD v1.1 §4.3 — no CREATED / APPROVAL_LINKED; ALTERNATE_METHOD→INITIATED is machine bootstrap for new payment correlationIds. */
export const PaymentMachineState = {
  INITIATED: 'INITIATED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  RETRY: 'RETRY',
  ALTERNATE_METHOD: 'ALTERNATE_METHOD',
} as const;

const { INITIATED, PROCESSING, SUCCESS, FAILED, RETRY, ALTERNATE_METHOD } = PaymentMachineState;

const states = new Set<string>(Object.values(PaymentMachineState));

/** PRD v1.3 §7.3 — only SUCCESS is terminal in payment machine. */
const terminalStates = new Set<string>([SUCCESS]);

const transitions = new Map<string, ReadonlySet<string>>([
  [ALTERNATE_METHOD, new Set([INITIATED]) as ReadonlySet<string>],
  [INITIATED, new Set([PROCESSING, FAILED]) as ReadonlySet<string>],
  [
    PROCESSING,
    new Set([SUCCESS, FAILED, RETRY, ALTERNATE_METHOD]) as ReadonlySet<string>,
  ],
  [FAILED, new Set([RETRY, ALTERNATE_METHOD]) as ReadonlySet<string>],
  [RETRY, new Set([PROCESSING]) as ReadonlySet<string>],
]);

export const paymentMachineDefinition: MachineDefinition = {
  kind: MachineKind.PAYMENT,
  states,
  terminalStates,
  transitions,
};
