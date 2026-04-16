type RawEnv = Record<string, unknown>;

function readString(env: RawEnv, key: string): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function validateEnv(raw: RawEnv): RawEnv {
  const env: RawEnv = { ...raw };
  const bootModeRaw = readString(env, 'APP_BOOT_MODE').toLowerCase();
  const bootMode = bootModeRaw === 'strict' ? 'strict' : 'demo-safe';
  env.APP_BOOT_MODE = bootMode;
  const required = ['COLLECTIQ_API_KEYS', 'COLLECTIQ_DATA_KEY'] as const;
  const missing = required.filter((k) => readString(env, k).length === 0);
  if (missing.length > 0) {
    warn('⚠️ Missing REQUIRED env vars detected:');
    for (const key of missing) {
      warn(`- ${key}`);
    }
    throw new Error(`Missing required env var(s): ${missing.join(', ')}`);
  }

  const optional = [
    'REDIS_URL',
    'DISABLE_TRACE_FULL',
    'COLLECTIQ_LOGS_MAX_PER_SECOND',
    'COLLECTIQ_LOGS_REDIS_MAX_ENTRIES',
    'COLLECTIQ_LOGS_REDIS_TTL_SECONDS',
    'COLLECTIQ_TRACE_SUMMARY_CACHE_TTL_SECONDS',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'PUBLIC_WEBHOOK_BASE_URL',
    'COLLECTIQ_NOTIFICATION_CHANNELS',
    'COLLECTIQ_SMTP_URL',
    'COLLECTIQ_NOTIFICATION_WEBHOOK_URL',
    'POLICY_EVALUATOR_MODE',
  ] as const;

  for (const key of optional) {
    const value = env[key];
    if (value !== undefined && typeof value !== 'string') {
      warn(`⚠️ Invalid env type: ${key} must be a string when provided. Ignoring this value.`);
      delete env[key];
    }
  }
  const providerOptional = ['STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID', 'OPENAI_API_KEY'] as const;
  const missingOptional = providerOptional.filter((k) => readString(env, k).length === 0);
  if (missingOptional.length > 0) {
    warn('⚠️ Optional provider env vars missing; boot will continue in safe fallback where needed:');
    for (const key of missingOptional) {
      warn(`- ${key}`);
    }
  }

  if (bootMode === 'strict' && readString(env, 'REDIS_URL').length === 0) {
    warn(
      '⚠️ APP_BOOT_MODE=strict but REDIS_URL is unset: tenant SSE uses in-memory fan-out (single API instance only).',
    );
  }
  const nodeEnv = readString(env, 'NODE_ENV').toLowerCase();
  if (nodeEnv === 'production' && readString(env, 'REDIS_URL').length === 0) {
    throw new Error('REDIS_URL is required in production for multi-instance SSE and observability.');
  }

  return env;
}
