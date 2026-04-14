type RawEnv = Record<string, unknown>;

function readString(env: RawEnv, key: string): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function isTruthy(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function validateEnv(raw: RawEnv): RawEnv {
  const env: RawEnv = { ...raw };
  const required = ['COLLECTIQ_API_KEYS', 'COLLECTIQ_DATA_KEY'] as const;
  const missing = required.filter((k) => readString(env, k).length === 0);
  const nodeEnv = readString(env, 'NODE_ENV');
  const allowFallback = isTruthy(env.ALLOW_ENV_FALLBACK);
  const canUseFallback = nodeEnv !== 'production' || allowFallback;

  if (missing.length > 0 && canUseFallback) {
    if (missing.includes('COLLECTIQ_API_KEYS')) {
      env.COLLECTIQ_API_KEYS = 'demo_key_123';
    }
    if (missing.includes('COLLECTIQ_DATA_KEY')) {
      env.COLLECTIQ_DATA_KEY = 'demo_data_key_123456';
    }

    warn('⚠️ Missing env vars detected:');
    for (const key of missing) {
      warn(`- ${key}`);
    }
    warn('Using fallback values for demo mode');
    warn('CollectIQ running in DEMO SAFE MODE (fallback env enabled)');
  } else if (missing.length > 0) {
    warn('⚠️ Missing env vars detected (no fallback applied):');
    for (const key of missing) {
      warn(`- ${key}`);
    }
    warn('Set required values or ALLOW_ENV_FALLBACK=true to enable demo fallbacks.');
  }

  const optional = [
    'COLLECTIQ_NOTIFICATION_CHANNELS',
    'COLLECTIQ_SMTP_URL',
    'COLLECTIQ_NOTIFICATION_WEBHOOK_URL',
  ] as const;

  for (const key of optional) {
    const value = env[key];
    if (value !== undefined && typeof value !== 'string') {
      warn(`⚠️ Invalid env type: ${key} must be a string when provided. Ignoring this value.`);
      delete env[key];
    }
  }

  return env;
}
