type RawEnv = Record<string, unknown>;

function readString(env: RawEnv, key: string): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

export function validateEnv(raw: RawEnv): RawEnv {
  const required = ['COLLECTIQ_API_KEYS', 'COLLECTIQ_DATA_KEY'] as const;
  const missing = required.filter((k) => readString(raw, k).length === 0);
  if (missing.length > 0) {
    throw new Error(`Missing required env var(s): ${missing.join(', ')}`);
  }

  const optional = [
    'COLLECTIQ_NOTIFICATION_CHANNELS',
    'COLLECTIQ_SMTP_URL',
    'COLLECTIQ_NOTIFICATION_WEBHOOK_URL',
  ] as const;

  for (const key of optional) {
    const value = raw[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`${key} must be a string when provided.`);
    }
  }

  return raw;
}
