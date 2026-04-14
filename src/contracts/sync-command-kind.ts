/**
 * SMEK → sync adapter command kinds (PRD v1.1 §6.3).
 */
export const SyncCommandKind = {
  PostPaymentSync: 'sync.post_payment',
} as const;

export type SyncCommandKind = (typeof SyncCommandKind)[keyof typeof SyncCommandKind];
