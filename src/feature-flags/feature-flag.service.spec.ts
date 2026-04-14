import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from './feature-flag.service';

function makeConfig(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('FeatureFlagService', () => {
  it('parses COLLECTIQ_FEATURE_* booleans', () => {
    const svc = new FeatureFlagService(
      makeConfig({
        COLLECTIQ_FEATURE_RESILIENCE_RETRIES: 'false',
        COLLECTIQ_FEATURE_RESILIENCE_CIRCUIT: '1',
      }),
    );
    expect(svc.resilienceRetriesEnabled()).toBe(false);
    expect(svc.resilienceCircuitBreakerEnabled()).toBe(true);
  });

  it('uses defaults when unset', () => {
    const svc = new FeatureFlagService(makeConfig({}));
    expect(svc.resilienceRetriesEnabled()).toBe(true);
    expect(svc.resilienceCircuitBreakerEnabled()).toBe(true);
  });

  it('isEnabled supports custom keys', () => {
    const svc = new FeatureFlagService(
      makeConfig({ COLLECTIQ_FEATURE_FOO_BAR: 'off' }),
    );
    expect(svc.isEnabled('FOO_BAR', true)).toBe(false);
    expect(svc.isEnabled('MISSING', false)).toBe(false);
  });
});
