import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantFeatureFlagModule } from '../../modules/tenant-feature-flags/tenant-feature-flag.module';
import { AI_EXECUTION_PORT, AI_PROVIDER } from '../adapter.tokens';
import { AiExecutionBridge } from './ai-execution.bridge';
import { OpenAiNegotiationAdapter } from './openai/openai-negotiation.adapter';
import { OpenAiAiConfig } from './openai/openai-ai.config';

@Global()
@Module({
  imports: [ConfigModule, TenantFeatureFlagModule],
  providers: [
    OpenAiAiConfig,
    OpenAiNegotiationAdapter,
    { provide: AI_PROVIDER, useExisting: OpenAiNegotiationAdapter },
    AiExecutionBridge,
    { provide: AI_EXECUTION_PORT, useExisting: AiExecutionBridge },
  ],
  exports: [
    OpenAiAiConfig,
    OpenAiNegotiationAdapter,
    { provide: AI_PROVIDER, useExisting: OpenAiNegotiationAdapter },
    { provide: AI_EXECUTION_PORT, useExisting: AiExecutionBridge },
  ],
})
export class AiAdapterModule {}
