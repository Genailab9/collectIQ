export const PAYMENT_PROCESSED = 'PAYMENT_PROCESSED' as const;

export type PaymentProcessedEventPayload = {
  paymentId: string;
  accountId: string;
  amount: number | null;
  method: string;
  correlationId: string;
  tenantId: string;
  timestamp: string;
};

