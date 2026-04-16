#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const targets = [
  'src/survival/survival-jobs.service.ts',
  'src/survival/notification-outbox.service.ts',
  'src/recovery/webhook-recovery.service.ts',
];

const violations = [];
for (const rel of targets) {
  const content = readFileSync(join(root, rel), 'utf8');
  const checks =
    rel === 'src/recovery/webhook-recovery.service.ts'
      ? [
          /for\s*\(const\s+.+?\s+of\s+.+?\)\s*\{[\s\S]{0,500}await\s+this\.(callTransitions|paymentTransitions)\./m,
          /for\s*\(const\s+.+?\s+of\s+.+?\)\s*\{[\s\S]{0,500}await\s+this\.(findLatestCallSidFromAudit|resolveGatewayPaymentIntentId)\(/m,
        ]
      : [
          /for\s*\(const\s+.+?\s+of\s+.+?\)\s*\{[\s\S]{0,500}await\s+this\.jobs\./m,
          /for\s*\(const\s+.+?\s+of\s+.+?\)\s*\{[\s\S]{0,500}await\s+this\.outbox\./m,
        ];
  if (checks.some((pattern) => pattern.test(content))) {
    violations.push(`${rel}: detected direct awaited DB access inside for-of loop`);
  }
}

if (violations.length > 0) {
  console.error('DB loop guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-no-db-await-loops: OK');
