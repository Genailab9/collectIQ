import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Env keys: `COLLECTIQ_FEATURE_<SUFFIX>` (boolean). */
export const COLLECTIQ_FEATURE_ENV_PREFIX = 'COLLECTIQ_FEATURE_' as const;

/**
 * PRD §17 — environment-driven feature flags for safe rollout (no remote flag service in v1).
 */
@Injectable()
export class FeatureFlagService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Reads `COLLECTIQ_FEATURE_<key>` where `key` is uppercase with underscores (e.g. `RESILIENCE_RETRIES`).
   */
  isEnabled(featureKey: string, defaultValue: boolean): boolean {
    const envKey = `${COLLECTIQ_FEATURE_ENV_PREFIX}${featureKey}`;
    const raw = this.config.get<string>(envKey);
    return this.parseBool(raw, defaultValue);
  }

  /** When false, `ResilienceService` performs a single attempt (no retries), PRD §5 adapter behavior. */
  resilienceRetriesEnabled(): boolean {
    return this.isEnabled('RESILIENCE_RETRIES', true);
  }

  /** When false, circuit breaker state is not applied (no open circuit, no failure accumulation). */
  resilienceCircuitBreakerEnabled(): boolean {
    return this.isEnabled('RESILIENCE_CIRCUIT', true);
  }

  /** SaaS / ops — non-secret snapshot of known feature toggles. */
  getKnownFlagsSnapshot(): Record<string, boolean> {
    return {
      RESILIENCE_RETRIES: this.resilienceRetriesEnabled(),
      RESILIENCE_CIRCUIT: this.resilienceCircuitBreakerEnabled(),
    };
  }

  private parseBool(raw: string | undefined, defaultValue: boolean): boolean {
    if (raw === undefined || raw.trim() === '') {
      return defaultValue;
    }
    const v = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(v)) {
      return false;
    }
    return defaultValue;
  }
}
