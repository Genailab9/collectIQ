import type { PaymentAdapter } from '../../../src/adapters/payment/payment.adapter';
import type {
  PaymentConfirmInput,
  PaymentConfirmResult,
  PaymentCreateIntentInput,
  PaymentCreateIntentResult,
  PaymentRetrieveIntentInput,
  PaymentRetrieveIntentResult,
} from '../../../src/adapters/payment/payment.types';

/**
 * Deterministic payment port for chaos / e2e (no Stripe network).
 */
export class ChaosPaymentAdapter implements PaymentAdapter {
  /** Number of `createIntent` calls that throw (simulates adapter timeout / flake). */
  createIntentFailuresBeforeSuccess = 0;

  /** Per-call index into `retrieveStatuses`; last entry repeats. */
  retrieveStatuses: string[] = ['succeeded'];

  confirmPaymentCallCount = 0;
  createIntentCallCount = 0;
  retrieveCallCount = 0;

  reset(): void {
    this.createIntentFailuresBeforeSuccess = 0;
    this.retrieveStatuses = ['succeeded'];
    this.confirmPaymentCallCount = 0;
    this.createIntentCallCount = 0;
    this.retrieveCallCount = 0;
  }

  async createIntent(input: PaymentCreateIntentInput): Promise<PaymentCreateIntentResult> {
    this.createIntentCallCount += 1;
    if (this.createIntentCallCount <= this.createIntentFailuresBeforeSuccess) {
      throw new Error('CHAOS_ADAPTER_TIMEOUT');
    }
    return {
      gatewayPaymentIntentId: `pi_chaos_${input.paymentId}`,
      status: 'requires_payment_method',
    };
  }

  async retrievePaymentIntent(input: PaymentRetrieveIntentInput): Promise<PaymentRetrieveIntentResult> {
    const i = this.retrieveCallCount;
    this.retrieveCallCount += 1;
    const status = this.retrieveStatuses[Math.min(i, this.retrieveStatuses.length - 1)]!;
    return { gatewayPaymentIntentId: input.gatewayPaymentIntentId.trim(), status };
  }

  async confirmPayment(input: PaymentConfirmInput): Promise<PaymentConfirmResult> {
    this.confirmPaymentCallCount += 1;
    return { gatewayPaymentIntentId: input.gatewayPaymentIntentId.trim(), status: 'succeeded' };
  }
}
