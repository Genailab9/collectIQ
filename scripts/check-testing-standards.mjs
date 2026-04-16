#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const requiredSpecFiles = [
  'src/modules/payment/payment.service.spec.ts',
  'src/modules/sync/sync.service.spec.ts',
  'src/compliance/compliance.service.spec.ts',
  'src/recovery/execution-recovery.service.spec.ts',
  'src/adapters/telephony/webhooks/twilio-webhook.service.spec.ts',
  'src/observability/observability.controller.spec.ts',
];

const chaosScript = join(root, 'scripts/chaos-test-pack.mjs');
const chaos = readFileSync(chaosScript, 'utf8');
const scenarios = [
  'payment-burst',
  'approval-timeout-wave',
  'webhook-duplication-storm',
  'webhook-out-of-order-replay',
  'adapter-partial-failure-loop',
  'mixed-chaos',
];

const violations = [];
for (const rel of requiredSpecFiles) {
  try {
    readFileSync(join(root, rel), 'utf8');
  } catch {
    violations.push(`missing required spec file: ${rel}`);
  }
}
for (const scenario of scenarios) {
  if (!chaos.includes(scenario)) {
    violations.push(`chaos scenario missing: ${scenario}`);
  }
}

if (violations.length > 0) {
  console.error('Testing standards guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-testing-standards: OK');
