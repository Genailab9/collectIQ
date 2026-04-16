#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const repoRoot = dirname(backendRoot);

const slosContract = JSON.parse(readFileSync(join(repoRoot, 'contracts/slos.contract.json'), 'utf8'));
const prometheusService = readFileSync(
  join(backendRoot, 'src/observability/prometheus-metrics.service.ts'),
  'utf8',
);
const alertRulesPath = join(backendRoot, 'prometheus', 'alerts.yml');
const alertRules = existsSync(alertRulesPath) ? readFileSync(alertRulesPath, 'utf8') : '';

const violations = [];
if (!Array.isArray(slosContract.slos) || slosContract.slos.length === 0) {
  violations.push('contracts/slos.contract.json: "slos" must be a non-empty array.');
}

const supportedOps = new Set(['<=', '<', '>=', '>', '=']);
const supportedSeverity = new Set(['low', 'medium', 'high', 'critical']);
for (const slo of slosContract.slos ?? []) {
  const id = String(slo.id ?? '').trim();
  const metric = String(slo.metric ?? '').trim();
  const target = slo.target ?? {};
  const operator = String(target.operator ?? '').trim();
  const value = Number(target.value);
  const severity = String(slo.severity ?? '').trim().toLowerCase();
  const escalation = slo.escalation ?? {};
  const onCallGroup = String(escalation.onCallGroup ?? '').trim();
  const playbookRef = String(escalation.playbookRef ?? '').trim();
  const maxAckMinutes = Number(escalation.maxAckMinutes);
  if (!id) violations.push('SLO entry missing id.');
  if (!metric) {
    violations.push(`${id || '<unknown>'}: missing metric.`);
  } else if (!prometheusService.includes(`${metric}:`)) {
    violations.push(`${id || '<unknown>'}: metric "${metric}" not found in Prometheus help map.`);
  }
  if (!supportedOps.has(operator)) {
    violations.push(`${id || '<unknown>'}: unsupported target.operator "${operator}".`);
  }
  if (!Number.isFinite(value)) {
    violations.push(`${id || '<unknown>'}: target.value must be numeric.`);
  }
  if (!supportedSeverity.has(severity)) {
    violations.push(`${id || '<unknown>'}: severity must be one of low|medium|high|critical.`);
  }
  if (!onCallGroup) {
    violations.push(`${id || '<unknown>'}: escalation.onCallGroup is required.`);
  }
  if (!playbookRef) {
    violations.push(`${id || '<unknown>'}: escalation.playbookRef is required.`);
  } else if (!existsSync(join(repoRoot, playbookRef))) {
    violations.push(`${id || '<unknown>'}: escalation.playbookRef "${playbookRef}" does not exist.`);
  }
  if (!Number.isFinite(maxAckMinutes) || maxAckMinutes < 1) {
    violations.push(`${id || '<unknown>'}: escalation.maxAckMinutes must be >= 1.`);
  }
  if (!alertRules.includes(metric)) {
    violations.push(
      `${id || '<unknown>'}: metric "${metric}" is not referenced by backend/prometheus/alerts.yml.`,
    );
  }
}

if (violations.length > 0) {
  console.error('SLO contract validation failed:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log('check-slos-contract: OK');
