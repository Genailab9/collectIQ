import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantFeatureFlagModule } from '../../modules/tenant-feature-flags/tenant-feature-flag.module';
import { TELEPHONY_EXECUTION_PORT, TELEPHONY_PROVIDER } from '../adapter.tokens';
import { TelephonyExecutionBridge } from './telephony-execution.bridge';
import { TwilioTelephonyAdapter } from './twilio/twilio-telephony.adapter';
import { TwilioTelephonyConfig } from './twilio/twilio-telephony.config';

@Global()
@Module({
  imports: [ConfigModule, TenantFeatureFlagModule],
  providers: [
    TwilioTelephonyConfig,
    TwilioTelephonyAdapter,
    { provide: TELEPHONY_PROVIDER, useExisting: TwilioTelephonyAdapter },
    TelephonyExecutionBridge,
    { provide: TELEPHONY_EXECUTION_PORT, useExisting: TelephonyExecutionBridge },
  ],
  exports: [
    TwilioTelephonyConfig,
    TelephonyExecutionBridge,
    { provide: TELEPHONY_PROVIDER, useExisting: TwilioTelephonyAdapter },
    { provide: TELEPHONY_EXECUTION_PORT, useExisting: TelephonyExecutionBridge },
  ],
})
export class TelephonyAdapterModule {}
