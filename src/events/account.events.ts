export const ACCOUNT_CLOSED = 'ACCOUNT_CLOSED' as const;

export type AccountClosedEventPayload = {
  accountId: string;
  correlationId: string;
  tenantId: string;
  timestamp: string;
};
