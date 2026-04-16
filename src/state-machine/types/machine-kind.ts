export const MachineKind = {
  DATA: 'DATA',
  CALL: 'CALL',
  APPROVAL: 'APPROVAL',
  PAYMENT: 'PAYMENT',
  SYNC: 'SYNC',
  ACCOUNT: 'ACCOUNT',
  CAMPAIGN: 'CAMPAIGN',
} as const;

export type MachineKind = (typeof MachineKind)[keyof typeof MachineKind];
