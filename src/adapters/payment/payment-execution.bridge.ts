import { Inject, Injectable } from '@nestjs/common';
import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import { PaymentCommandKind } from '../../contracts/payment-command-kind';
import type { PaymentExecutionPort } from '../../contracts/payment-execution.port';
import { ExecutionFeatureFlagsService } from '../../modules/tenant-feature-flags/execution-feature-flags.service';
import { PAYMENT_PROVIDER } from '../adapter.tokens';
import type { PaymentAdapter } from './payment.adapter';
import { PaymentCommandUnsupportedError } from './payment.errors';
import type { PaymentConfirmInput, PaymentCreateIntentInput, PaymentRetrieveIntentInput } from './payment.types';

@Injectable()
export class PaymentExecutionBridge implements PaymentExecutionPort {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentAdapter,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  async execute(envelope: AdapterEnvelope): Promise<unknown> {
    switch (envelope.kind) {
      case PaymentCommandKind.CreateIntent: {
        const body = envelope.body as PaymentCreateIntentInput;
        if (await this.executionFlags.isJsonTruthy(body.tenantId, 'DEMO_MODE')) {
          return {
            gatewayPaymentIntentId: `pi_collectiq_demo_${body.paymentId}`,
            status: 'requires_confirmation',
          };
        }
        return this.payment.createIntent(body);
      }
      case PaymentCommandKind.ConfirmPayment: {
        const body = envelope.body as PaymentConfirmInput;
        if (await this.executionFlags.isJsonTruthy(body.tenantId, 'DEMO_MODE')) {
          return {
            gatewayPaymentIntentId: body.gatewayPaymentIntentId,
            status: 'succeeded',
          };
        }
        return this.payment.confirmPayment(body);
      }
      case PaymentCommandKind.RetrieveIntent: {
        const body = envelope.body as PaymentRetrieveIntentInput;
        return this.payment.retrievePaymentIntent(body);
      }
      default:
        throw new PaymentCommandUnsupportedError(envelope.kind);
    }
  }
}
