import { Inject, Injectable } from '@nestjs/common';
import { AiCommandKind } from '../../contracts/ai-command-kind';
import type { AiExecutionPort } from '../../contracts/ai-execution.port';
import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import { ExecutionFeatureFlagsService } from '../../modules/tenant-feature-flags/execution-feature-flags.service';
import { AI_PROVIDER } from '../adapter.tokens';
import type { AiAdapter } from './ai.adapter';
import { AiCommandUnsupportedError } from './ai.errors';
import type { AiNegotiationInput } from './ai.types';

@Injectable()
export class AiExecutionBridge implements AiExecutionPort {
  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiAdapter,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  async execute(envelope: AdapterEnvelope): Promise<unknown> {
    switch (envelope.kind) {
      case AiCommandKind.NegotiationSuggest: {
        const body = envelope.body as AiNegotiationInput;
        if (await this.executionFlags.isJsonTruthy(body.tenantId, 'DEMO_MODE')) {
          return {
            intent: 'Borrower open to settlement (demo-mode deterministic).',
            offerSuggestion: 'Offer a structured 3-installment payment plan.',
            negotiationStrategy: 'Confirm hardship details and summarize next steps.',
          };
        }
        return this.ai.suggestNegotiation(body);
      }
      default:
        throw new AiCommandUnsupportedError(envelope.kind);
    }
  }
}
