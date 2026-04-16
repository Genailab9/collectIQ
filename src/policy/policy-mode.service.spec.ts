import { PolicyModeService } from './policy-mode.service';

describe('PolicyModeService', () => {
  const mk = (env: Record<string, string | undefined>) => {
    const config = {
      get: jest.fn((key: string) => env[key]),
    };
    return new PolicyModeService(config as never);
  };

  it('defaults to shadow in non-production when POLICY_EVALUATOR_MODE unset', () => {
    const svc = mk({ NODE_ENV: 'test' });
    expect(svc.getMode()).toBe('shadow');
  });

  it('returns enforce when POLICY_EVALUATOR_MODE is enforce', () => {
    const svc = mk({ NODE_ENV: 'development', POLICY_EVALUATOR_MODE: 'enforce' });
    expect(svc.getMode()).toBe('enforce');
  });

  it('returns legacy_deprecated when set', () => {
    const svc = mk({ NODE_ENV: 'production', POLICY_EVALUATOR_MODE: 'legacy_deprecated' });
    expect(svc.getMode()).toBe('legacy_deprecated');
  });

  it('forces enforce in production when mode unset', () => {
    const svc = mk({ NODE_ENV: 'production' });
    expect(svc.getMode()).toBe('enforce');
  });

  it('forces enforce in production when mode is shadow without opt-in', () => {
    const svc = mk({ NODE_ENV: 'production', POLICY_EVALUATOR_MODE: 'shadow' });
    expect(svc.getMode()).toBe('enforce');
  });

  it('allows shadow in production only with explicit opt-in', () => {
    const svc = mk({
      NODE_ENV: 'production',
      POLICY_EVALUATOR_MODE: 'shadow',
      POLICY_ALLOW_SHADOW_IN_PRODUCTION: 'true',
    });
    expect(svc.getMode()).toBe('shadow');
  });
});
