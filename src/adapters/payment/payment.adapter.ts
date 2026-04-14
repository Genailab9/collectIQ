import type {
  PaymentConfirmInput,
  PaymentConfirmResult,
  PaymentCreateIntentInput,
  PaymentCreateIntentResult,
  PaymentRetrieveIntentInput,
  PaymentRetrieveIntentResult,
} from './payment.types';

/**
 * Swappable payment gateway port. Implementations MUST live under provider-specific packages.
 * The SMEK kernel must never import gateway SDKs.
 */
export interface PaymentAdapter {
  createIntent(input: PaymentCreateIntentInput): Promise<PaymentCreateIntentResult>;
  /** Read-only status from the provider (PRD §7 — never infer payment state from the client). */
  retrievePaymentIntent(input: PaymentRetrieveIntentInput): Promise<PaymentRetrieveIntentResult>;
  confirmPayment(input: PaymentConfirmInput): Promise<PaymentConfirmResult>;
}
