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
  /** PRD Phase 4 — post-settlement refund (no duplicate financial success transition). */
  REFUNDED: 'REFUNDED',
  /** PRD Phase 4 — dispute opened after successful capture. */
  DISPUTED: 'DISPUTED',
} as const;

const { INITIATED, PROCESSING, SUCCESS, FAILED, RETRY, ALTERNATE_METHOD, REFUNDED, DISPUTED } =
  PaymentMachineState;

const states = new Set<string>(Object.values(PaymentMachineState));

/**
 * REFUNDED / DISPUTED are strict terminals. SUCCESS is a business-complete hub that may still receive
 * provider-driven refund/dispute edges (see `ExecutionRecoveryService` — auto-recovery skips PAYMENT@SUCCESS).
 */
const terminalStates = new Set<string>([REFUNDED, DISPUTED]);

const transitions = new Map<string, ReadonlySet<string>>([
  [ALTERNATE_METHOD, new Set([INITIATED]) as ReadonlySet<string>],
  [INITIATED, new Set([PROCESSING, FAILED]) as ReadonlySet<string>],
  [
    PROCESSING,
    new Set([SUCCESS, FAILED, RETRY, ALTERNATE_METHOD]) as ReadonlySet<string>,
  ],
  [FAILED, new Set([RETRY, ALTERNATE_METHOD]) as ReadonlySet<string>],
  [RETRY, new Set([PROCESSING]) as ReadonlySet<string>],
  [SUCCESS, new Set([REFUNDED, DISPUTED]) as ReadonlySet<string>],
]);

export const paymentMachineDefinition: MachineDefinition = {
  kind: MachineKind.PAYMENT,
  states,
  terminalStates,
  transitions,
};
