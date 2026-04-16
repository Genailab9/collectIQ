#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = join(fileURLToPath(new URL('..', import.meta.url)), 'src');
const targets = [
  'modules/approval/approval-transition-query.service.ts',
  'modules/payment/payment-transition-query.service.ts',
  'modules/sync/sync-transition-query.service.ts',
  'adapters/telephony/call-transition-query.service.ts',
  'tenant/tenant-correlation-resolver.service.ts',
  'survival/survival-jobs.service.ts',
  'survival/notification-outbox.service.ts',
  'recovery/webhook-recovery.service.ts',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(srcRoot).filter((file) => {
  const rel = relative(srcRoot, file).replaceAll('\\', '/');
  return targets.includes(rel);
});

const violations = [];
for (const file of files) {
  const rel = relative(srcRoot, file).replaceAll('\\', '/');
  const txt = readFileSync(file, 'utf8');
  const hasDirectQueryBuilder = /\.createQueryBuilder\s*\(/.test(txt);
  if (!hasDirectQueryBuilder) continue;
  const hasScopedRepo = /tenantQueryScope\.forRepo\s*\(/.test(txt);
  const hasCrossTenantMarker = /tenantQueryScope\.withCrossTenantScope\s*\(/.test(txt);
  const hasTenantPredicate = /tenantId\s*=|tenant_id\s*=|tenantId IS NOT NULL|tenant_id IS NOT NULL/.test(txt);
  if (!hasScopedRepo && !hasCrossTenantMarker && !hasTenantPredicate) {
    violations.push(rel);
  }
}

if (violations.length > 0) {
  console.error('Tenant query scope guard failed. Query services must use TenantQueryScopeService.');
  for (const rel of violations) {
    console.error(`  - src/${rel}`);
  }
  console.error(
    'Use tenantQueryScope.forRepo(...) for tenant-scoped reads, or enforce explicit tenant predicates in every query builder path.',
  );
  process.exit(1);
}

console.log('check-tenant-query-scope: OK');
