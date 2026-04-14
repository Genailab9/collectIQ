/**
 * SMEK → payment gateway command kinds (structural routing only).
 * PRD v1.1 §8: INITIATED → PROCESSING → SUCCESS / FAILED (adapter surface minimized).
 */
export const PaymentCommandKind = {
  CreateIntent: 'payment.intent.create',
  ConfirmPayment: 'payment.confirm',
  RetrieveIntent: 'payment.intent.retrieve',
} as const;

export type PaymentCommandKind =
  (typeof PaymentCommandKind)[keyof typeof PaymentCommandKind];
