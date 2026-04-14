export const MachineKind = {
  DATA: 'DATA',
  CALL: 'CALL',
  APPROVAL: 'APPROVAL',
  PAYMENT: 'PAYMENT',
  SYNC: 'SYNC',
} as const;

export type MachineKind = (typeof MachineKind)[keyof typeof MachineKind];
