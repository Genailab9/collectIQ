import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantFeatureFlagModule } from '../../modules/tenant-feature-flags/tenant-feature-flag.module';
import { PAYMENT_EXECUTION_PORT, PAYMENT_PROVIDER } from '../adapter.tokens';
import { PaymentExecutionBridge } from './payment-execution.bridge';
import { StripePaymentAdapter } from './stripe/stripe-payment.adapter';
import { StripePaymentConfig } from './stripe/stripe-payment.config';

@Global()
@Module({
  imports: [ConfigModule, TenantFeatureFlagModule],
  providers: [
    StripePaymentConfig,
    StripePaymentAdapter,
    { provide: PAYMENT_PROVIDER, useExisting: StripePaymentAdapter },
    PaymentExecutionBridge,
    { provide: PAYMENT_EXECUTION_PORT, useExisting: PaymentExecutionBridge },
  ],
  exports: [
    StripePaymentConfig,
    StripePaymentAdapter,
    { provide: PAYMENT_PROVIDER, useExisting: StripePaymentAdapter },
    { provide: PAYMENT_EXECUTION_PORT, useExisting: PaymentExecutionBridge },
  ],
})
export class PaymentAdapterModule {}
