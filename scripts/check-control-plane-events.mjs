#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const targets = [
  'src/modules/tenant-feature-flags/tenant-feature-flag.controller.ts',
  'src/saas/saas-admin.controller.ts',
  'src/saas/saas-billing.controller.ts',
];

const requiredTaxonomyValues = ['CONTROL_PLANE_EVENT', 'SYSTEM_PLANE_EVENT', 'DATA_PLANE_EVENT'];
const violations = [];

for (const rel of targets) {
  const content = readFileSync(join(root, rel), 'utf8');
  const emitCalls = content.match(/emitPlaneEvent\([\s\S]*?\}\);/g) ?? [];
  if (emitCalls.length === 0) {
    violations.push(`${rel}: expected at least one emitPlaneEvent(...) call`);
    continue;
  }
  for (const call of emitCalls) {
    const taxonomyMatch = call.match(/taxonomy:\s*'([^']+)'/);
    const actionMatch = call.match(/action:\s*'([^']+)'/);
    const adapterMatch = call.match(/adapter:\s*'([^']+)'/);
    if (!taxonomyMatch || !requiredTaxonomyValues.includes(taxonomyMatch[1])) {
      violations.push(`${rel}: emitPlaneEvent call must declare supported taxonomy literal`);
    }
    if (!actionMatch || !actionMatch[1].includes(':')) {
      violations.push(`${rel}: emitPlaneEvent action must be namespaced (e.g. DOMAIN:ACTION)`);
    }
    if (!adapterMatch || !adapterMatch[1].includes('.')) {
      violations.push(`${rel}: emitPlaneEvent adapter must be namespaced (e.g. saas.billing)`);
    }
  }
}

if (violations.length > 0) {
  console.error('Control-plane event normalization guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-control-plane-events: OK');
