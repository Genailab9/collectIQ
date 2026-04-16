const executionPrefixes = ['/execution', '/api/v1/execution'];
const approvalPrefixes = ['/approvals'];
const paymentPrefixes = ['/payments'];
const webhookPrefixes = ['/webhooks'];
const observabilityPrefixes = ['/observability', '/api/v1/observability', '/metrics', '/api/v1/events'];

export function mapPathToRequirementId(path: string): string {
  const p = path.split('?')[0] ?? '';
  if (executionPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return 'REQ-CORE-001';
  }
  if (approvalPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return 'REQ-APR-001';
  }
  if (paymentPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return 'REQ-PAY-001';
  }
  if (webhookPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return 'REQ-SEC-002';
  }
  if (observabilityPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return 'REQ-OBS-001';
  }
  return 'REQ-UNMAPPED';
}

export function mapTableToRequirementId(tableName: string): string {
  const t = tableName.trim().toLowerCase();
  if (t === 'idempotency_keys') return 'REQ-IDEMP-001';
  if (t === 'state_transition_log') return 'REQ-SM-001';
  if (t === 'webhook_events') return 'REQ-WEB-001';
  if (t.includes('tenant')) return 'REQ-TEN-001';
  if (t.includes('payment')) return 'REQ-PAY-001';
  return 'REQ-UNMAPPED';
}

