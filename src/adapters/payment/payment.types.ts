export interface PaymentCreateIntentInput {
  readonly paymentId: string;
  readonly tenantId: string;
  readonly amountCents: number;
  readonly currency: string;
  /** Passed to the gateway as its idempotency key (Stripe idempotency-key header). */
  readonly gatewayIdempotencyKey: string;
  /** PRD v1.1 §8.3 — approval correlation must be APPROVED before payment; stored on gateway metadata. */
  readonly approvalCorrelationId: string;
}

export interface PaymentCreateIntentResult {
  readonly gatewayPaymentIntentId: string;
  readonly status: string;
}

export interface PaymentRetrieveIntentInput {
  readonly gatewayPaymentIntentId: string;
}

export interface PaymentRetrieveIntentResult {
  readonly gatewayPaymentIntentId: string;
  readonly status: string;
}

export interface PaymentConfirmInput {
  readonly paymentId: string;
  readonly tenantId: string;
  readonly gatewayPaymentIntentId: string;
  /**
   * Stripe RequestOptions.idempotencyKey for `paymentIntents.confirm` only (PRD §7 — never double-confirm).
   */
  readonly stripeConfirmIdempotencyKey: string;
}

export interface PaymentConfirmResult {
  readonly gatewayPaymentIntentId: string;
  readonly status: string;
}
