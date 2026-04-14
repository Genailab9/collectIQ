export class CreatePaymentIntentDto {
  idempotencyKey!: string;
  amountCents!: number;
  currency?: string;
  /** PRD v1.1 §8.3 — must already be APPROVED on the APPROVAL machine. */
  approvalCorrelationId!: string;
  borrowerOptedOut?: boolean;
}

export class ConfirmPaymentDto {
  gatewayPaymentIntentId!: string;
  /** PRD v1.2 §2 — scopes confirm + post-payment sync SMEK loops. */
  idempotencyKey!: string;
  borrowerOptedOut?: boolean;
}
