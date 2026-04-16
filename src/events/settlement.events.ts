export const SETTLEMENT_ACCEPTED = 'SETTLEMENT_ACCEPTED' as const;

export type SettlementAcceptedEventPayload = {
  approvalId: string;
  accountId: string;
  proposedAmount: number | null;
  discountPercentage: number | null;
  correlationId: string;
  tenantId: string;
  timestamp: string;
};

