import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PolicyEvaluatorMode = 'shadow' | 'enforce' | 'legacy_deprecated';

/**
 * Production defaults to enforce so policy denials are never bypassed by shadow semantics.
 * Opt-in to shadow in production only with POLICY_ALLOW_SHADOW_IN_PRODUCTION=true (canary / migration).
 */
@Injectable()
export class PolicyModeService {
  constructor(private readonly config: ConfigService) {}

  getMode(): PolicyEvaluatorMode {
    const modeRaw = this.config.get<string>('POLICY_EVALUATOR_MODE')?.trim().toLowerCase();
    const nodeEnv = this.config.get<string>('NODE_ENV')?.trim().toLowerCase() ?? '';
    const allowProdShadow =
      this.config.get<string>('POLICY_ALLOW_SHADOW_IN_PRODUCTION')?.trim().toLowerCase() === 'true';

    if (modeRaw === 'legacy_deprecated') {
      return 'legacy_deprecated';
    }

    if (nodeEnv === 'production') {
      if (allowProdShadow && modeRaw === 'shadow') {
        return 'shadow';
      }
      return 'enforce';
    }

    if (modeRaw === 'enforce') {
      return 'enforce';
    }
    return 'shadow';
  }
}
