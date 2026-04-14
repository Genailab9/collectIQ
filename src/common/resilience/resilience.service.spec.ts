import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';
import { ResilienceCircuitOpenError } from './resilience.errors';
import { ResilienceService } from './resilience.service';

function configStub(overrides: Record<string, string> = {}): ConfigService {
  const map: Record<string, string> = {
    RESILIENCE_FAILURE_THRESHOLD: '2',
    RESILIENCE_COOLDOWN_MS: '60000',
    ...overrides,
  };
  return {
    get: (key: string) => map[key],
  } as unknown as ConfigService;
}

function flagsFromEnv(env: Record<string, string>): FeatureFlagService {
  return new FeatureFlagService({
    get: (k: string) => env[k],
  } as unknown as ConfigService);
}

describe('ResilienceService', () => {
  it('opens circuit after threshold failures and throws structured error', async () => {
    const svc = new ResilienceService(configStub());
    const key = 'test:circuit:a';

    await expect(
      svc.executeWithRetry({
        fn: async () => {
          throw new Error('boom1');
        },
        retries: 0,
        backoff: 1,
        circuitKey: key,
        unsafeAllowRetriesWithoutIdempotencyKey: true,
      }),
    ).rejects.toThrow('boom1');

    await expect(
      svc.executeWithRetry({
        fn: async () => {
          throw new Error('boom2');
        },
        retries: 0,
        backoff: 1,
        circuitKey: key,
        unsafeAllowRetriesWithoutIdempotencyKey: true,
      }),
    ).rejects.toThrow('boom2');

    await expect(
      svc.executeWithRetry({
        fn: async () => 'ok',
        retries: 0,
        backoff: 1,
        circuitKey: key,
        unsafeAllowRetriesWithoutIdempotencyKey: true,
      }),
    ).rejects.toMatchObject({
      code: 'RESILIENCE_CIRCUIT_OPEN',
      circuitKey: key,
    });
  });

  it('does not retry without idempotency key or explicit unsafe flag', async () => {
    const svc = new ResilienceService(configStub({ RESILIENCE_FAILURE_THRESHOLD: '99' }));
    let calls = 0;
    await expect(
      svc.executeWithRetry({
        fn: async () => {
          calls += 1;
          throw new Error('fail');
        },
        retries: 5,
        backoff: 1,
        circuitKey: 'test:no-retry',
      }),
    ).rejects.toThrow('fail');
    expect(calls).toBe(1);
  });

  it('retries when idempotencyKey is present and eventually succeeds', async () => {
    const svc = new ResilienceService(configStub({ RESILIENCE_FAILURE_THRESHOLD: '99' }));
    let n = 0;
    const r = await svc.executeWithRetry({
      fn: async () => {
        n += 1;
        if (n < 3) {
          throw new Error('transient');
        }
        return 'done';
      },
      retries: 4,
      backoff: 1,
      circuitKey: 'test:idem',
      idempotencyKey: 'idem-1',
    });
    expect(r).toBe('done');
    expect(n).toBe(3);
  });

  it('does not trip circuit on transient failures that succeed within the same invocation', async () => {
    const svc = new ResilienceService(configStub({ RESILIENCE_FAILURE_THRESHOLD: '2' }));
    let n = 0;
    await svc.executeWithRetry({
      fn: async () => {
        n += 1;
        if (n < 2) {
          throw new Error('transient');
        }
        return 'ok';
      },
      retries: 3,
      backoff: 1,
      circuitKey: 'test:recover-in-call',
      idempotencyKey: 'k',
    });
    await svc.executeWithRetry({
      fn: async () => 'second',
      retries: 0,
      backoff: 1,
      circuitKey: 'test:recover-in-call',
      idempotencyKey: 'k',
    });
    expect(n).toBe(2);
  });

  it('does not open circuit when COLLECTIQ_FEATURE_RESILIENCE_CIRCUIT is off', async () => {
    const flags = flagsFromEnv({ COLLECTIQ_FEATURE_RESILIENCE_CIRCUIT: 'false' });
    const svc = new ResilienceService(configStub(), flags);
    const key = 'test:circuit:flags-off';

    for (let i = 0; i < 5; i += 1) {
      await expect(
        svc.executeWithRetry({
          fn: async () => {
            throw new Error(`e${i}`);
          },
          retries: 0,
          backoff: 1,
          circuitKey: key,
          unsafeAllowRetriesWithoutIdempotencyKey: true,
        }),
      ).rejects.toThrow(`e${i}`);
    }

    await expect(
      svc.executeWithRetry({
        fn: async () => 'ok',
        retries: 0,
        backoff: 1,
        circuitKey: key,
        unsafeAllowRetriesWithoutIdempotencyKey: true,
      }),
    ).resolves.toBe('ok');
  });

  it('does not retry when COLLECTIQ_FEATURE_RESILIENCE_RETRIES is off', async () => {
    const flags = flagsFromEnv({ COLLECTIQ_FEATURE_RESILIENCE_RETRIES: 'false' });
    const svc = new ResilienceService(configStub({ RESILIENCE_FAILURE_THRESHOLD: '99' }), flags);
    let calls = 0;
    await expect(
      svc.executeWithRetry({
        fn: async () => {
          calls += 1;
          throw new Error('fail');
        },
        retries: 5,
        backoff: 1,
        circuitKey: 'test:retry-flag-off',
        idempotencyKey: 'idem',
      }),
    ).rejects.toThrow('fail');
    expect(calls).toBe(1);
  });
});
