#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const targets = JSON.parse(
  readFileSync(join(root, 'scripts/generated-policy-governance-targets.json'), 'utf8'),
);

const violations = [];

for (const rel of targets) {
  const file = join(root, rel);
  const content = readFileSync(file, 'utf8');
  const usesInlinePolicyEvaluation =
    content.includes('this.policies.evaluate(') && content.includes('this.policyAudit.record(');
  const usesCentralizedEnforcement =
    content.includes('this.policyEnforcement.enforceAdminOperation(') ||
    content.includes('this.policyEnforcement.enforceFeatureFlagUpsert(') ||
    content.includes('this.policyEnforcement.enforceTenantOperation(');
  if (!usesInlinePolicyEvaluation && !usesCentralizedEnforcement) {
    violations.push(
      `${rel}: missing policy governance call (expected inline policies.evaluate+policyAudit.record or policyEnforcement.enforce*)`,
    );
  }
  if (content.includes("get<string>('POLICY_EVALUATOR_MODE')")) {
    violations.push(`${rel}: direct POLICY_EVALUATOR_MODE config read detected (use PolicyModeService)`);
  }
}

if (violations.length > 0) {
  console.error('Policy governance guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-policy-governance: OK');
