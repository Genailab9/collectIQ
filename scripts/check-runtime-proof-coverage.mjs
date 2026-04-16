#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);

const checks = [
  {
    id: 'tenant_isolation_denial_proof',
    path: 'src/tenant/tenant-isolation.subscriber.ts',
    mustContain: ['emitRuntimeProof', 'tenant_context_missing_query'],
  },
  {
    id: 'smek_compliance_block_proof',
    path: 'src/kernel/smek-kernel.service.ts',
    mustContain: ['emitRuntimeProof', 'REQ-COMP-001', 'COMPLIANCE_BLOCKED'],
  },
  {
    id: 'recovery_dispatch_proof',
    path: 'src/recovery/execution-recovery.service.ts',
    mustContain: ['emitRuntimeProof', 'RECOVERY_SMEK_DISPATCH', "action: 'dispatch'"],
  },
];

const violations = [];
for (const check of checks) {
  const full = join(backendRoot, check.path);
  const text = readFileSync(full, 'utf8');
  for (const needle of check.mustContain) {
    if (!text.includes(needle)) {
      violations.push(`${check.id}: ${check.path} missing "${needle}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('Runtime-proof coverage check failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('runtime_proof_coverage: PASS');
