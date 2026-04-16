#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const contract = JSON.parse(readFileSync(join(root, 'contracts/metrics.contract.json'), 'utf8'));

const violations = [];

function checkTargetGroup(targets, groupName) {
  for (const target of targets) {
    const rel = target.path;
    const requiredCalls = Array.isArray(target.requiredCalls) ? target.requiredCalls : [];
    const content = readFileSync(join(root, rel), 'utf8');
    for (const requiredCall of requiredCalls) {
      if (!content.includes(requiredCall)) {
        violations.push(`${rel}: missing ${groupName} contract call (${requiredCall})`);
      }
    }
  }
}

const prometheusServicePath = join(root, contract.prometheusServicePath);
const metricsServiceContent = readFileSync(prometheusServicePath, 'utf8');
for (const methodName of contract.metricMethods ?? []) {
  if (!metricsServiceContent.includes(`${methodName}(`)) {
    violations.push(`${contract.prometheusServicePath}: missing declared metric method (${methodName})`);
  }
}
checkTargetGroup(contract.apiTargets ?? [], 'API');
checkTargetGroup(contract.workerTargets ?? [], 'worker');
checkTargetGroup(contract.controlPlaneTargets ?? [], 'control-plane');

if (violations.length > 0) {
  console.error('Metrics/control-plane contract guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-metrics-contract: OK');
