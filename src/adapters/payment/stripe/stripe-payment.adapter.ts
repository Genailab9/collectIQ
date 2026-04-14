import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import type { PaymentAdapter } from '../payment.adapter';
import { PaymentGatewayConfigurationError, PaymentGatewayError } from '../payment.errors';
import type {
  PaymentConfirmInput,
  PaymentConfirmResult,
  PaymentCreateIntentInput,
  PaymentCreateIntentResult,
  PaymentRetrieveIntentInput,
  PaymentRetrieveIntentResult,
} from '../payment.types';
import { StripePaymentConfig } from './stripe-payment.config';

@Injectable()
export class StripePaymentAdapter implements PaymentAdapter {
  private readonly stripe: Stripe;

  constructor(private readonly cfg: StripePaymentConfig) {
    const key = this.cfg.secretKey;
    if (!key) {
      throw new PaymentGatewayConfigurationError('STRIPE_SECRET_KEY is not configured.');
    }
    this.stripe = new Stripe(key, { typescript: true });
  }

  async retrievePaymentIntent(
    input: PaymentRetrieveIntentInput,
  ): Promise<PaymentRetrieveIntentResult> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(input.gatewayPaymentIntentId);
      return { gatewayPaymentIntentId: pi.id, status: pi.status };
    } catch (cause) {
      throw new PaymentGatewayError('Stripe PaymentIntent retrieve failed.', cause);
    }
  }

  async createIntent(input: PaymentCreateIntentInput): Promise<PaymentCreateIntentResult> {
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          metadata: {
            collectiq_payment_id: input.paymentId,
            tenant_id: input.tenantId,
            approval_correlation_id: input.approvalCorrelationId,
          },
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: input.gatewayIdempotencyKey },
      );
      return { gatewayPaymentIntentId: pi.id, status: pi.status };
    } catch (cause) {
      throw new PaymentGatewayError('Stripe PaymentIntent create failed.', cause);
    }
  }

  async confirmPayment(input: PaymentConfirmInput): Promise<PaymentConfirmResult> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(input.gatewayPaymentIntentId);
      if (pi.status === 'requires_confirmation') {
        const confirmed = await this.stripe.paymentIntents.confirm(
          input.gatewayPaymentIntentId,
          {},
          { idempotencyKey: input.stripeConfirmIdempotencyKey },
        );
        return { gatewayPaymentIntentId: confirmed.id, status: confirmed.status };
      }
      if (pi.status !== 'succeeded') {
        throw new PaymentGatewayError(
          `PaymentIntent ${pi.id} is not succeeded (status=${pi.status}).`,
        );
      }
      return { gatewayPaymentIntentId: pi.id, status: pi.status };
    } catch (cause) {
      if (cause instanceof PaymentGatewayError) {
        throw cause;
      }
      throw new PaymentGatewayError('Stripe PaymentIntent confirm failed.', cause);
    }
  }
}
