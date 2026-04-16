import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

export const ApprovalMachineState = {
  REQUESTED: 'REQUESTED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COUNTERED: 'COUNTERED',
  /** PRD v1.1 §4.2 — deadline elapsed while still awaiting officer (distinct from explicit ESCALATED). */
  TIMEOUT: 'TIMEOUT',
  ESCALATED: 'ESCALATED',
} as const;

const states = new Set<string>(Object.values(ApprovalMachineState));

const terminalStates = new Set<string>([
  ApprovalMachineState.APPROVED,
  ApprovalMachineState.REJECTED,
]);

const transitions = new Map<string, ReadonlySet<string>>([
  [
    ApprovalMachineState.REQUESTED,
    new Set([
      ApprovalMachineState.PENDING,
      ApprovalMachineState.APPROVED,
      ApprovalMachineState.COUNTERED,
    ]) as ReadonlySet<string>,
  ],
  [
    ApprovalMachineState.PENDING,
    new Set([
      ApprovalMachineState.APPROVED,
      ApprovalMachineState.REJECTED,
      ApprovalMachineState.COUNTERED,
      ApprovalMachineState.TIMEOUT,
      ApprovalMachineState.ESCALATED,
    ]) as ReadonlySet<string>,
  ],
  [
    ApprovalMachineState.COUNTERED,
    new Set([
      ApprovalMachineState.APPROVED,
      ApprovalMachineState.REJECTED,
      ApprovalMachineState.PENDING,
    ]) as ReadonlySet<string>,
  ],
  [
    ApprovalMachineState.TIMEOUT,
    new Set([
      ApprovalMachineState.PENDING,
      ApprovalMachineState.APPROVED,
      ApprovalMachineState.REJECTED,
    ]) as ReadonlySet<string>,
  ],
  [
    ApprovalMachineState.ESCALATED,
    new Set([
      ApprovalMachineState.PENDING,
      ApprovalMachineState.APPROVED,
      ApprovalMachineState.REJECTED,
    ]) as ReadonlySet<string>,
  ],
]);

export const approvalMachineDefinition: MachineDefinition = {
  kind: MachineKind.APPROVAL,
  states,
  terminalStates,
  transitions,
};
