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
  'src/modules/approval/approval.service.ts',
  'src/adapters/payment/webhooks/stripe-webhook.service.ts',
  'src/adapters/telephony/webhooks/twilio-webhook.service.ts',
  'src/recovery/execution-recovery.service.ts',
];

const violations = [];
for (const rel of targets) {
  const content = readFileSync(join(root, rel), 'utf8');
  const hasMutations =
    content.includes('.update(') ||
    content.includes('.insert(') ||
    content.includes('.save(') ||
    content.includes('.createQueryBuilder()');
  if (!hasMutations) {
    continue;
  }
  if (!content.includes('this.structured.emit(')) {
    violations.push(`${rel}: mutation path missing structured event emission`);
  }
}

if (violations.length > 0) {
  console.error('State-change event guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-state-change-events: OK');
