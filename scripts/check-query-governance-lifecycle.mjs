#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);

const governance = JSON.parse(
  readFileSync(join(backendRoot, 'contracts/query-governance.contract.json'), 'utf8'),
);
const lifecycle = JSON.parse(
  readFileSync(join(backendRoot, 'contracts/query-governance.lifecycle.contract.json'), 'utf8'),
);

const now = Date.now();
const violations = [];
const allowedStatuses = new Set(['active', 'sunset', 'retired']);
const allowedExpiryPolicies = new Set(['must-shrink', 'review-only', 'remove-by-date', 'remove-on-migration']);

function hasLifecycleCoverage(file, rule) {
  for (const entry of lifecycle.entries ?? []) {
    if (String(entry.file ?? '').trim() !== file) continue;
    const rules = Array.isArray(entry.rules) ? entry.rules : [];
    if (rules.includes('*') || rules.includes(rule)) return true;
  }
  return false;
}

for (const entry of lifecycle.entries ?? []) {
  const file = String(entry.file ?? '').trim();
  const owner = String(entry.owner ?? '').trim();
  const reason = String(entry.reason ?? '').trim();
  const createdAt = String(entry.createdAt ?? '').trim();
  const lastReviewedAt = String(entry.lastReviewedAt ?? '').trim();
  const reviewCycleDays = Number(entry.reviewCycleDays);
  const expiryPolicy = String(entry.expiryPolicy ?? '').trim();
  const status = String(entry.status ?? '').trim();
  const shrinkTarget = String(entry.shrinkTarget ?? '').trim();

  if (!file) violations.push('Lifecycle entry missing file.');
  if (!owner) violations.push(`${file || '<unknown>'}: missing owner.`);
  if (!reason) violations.push(`${file || '<unknown>'}: missing reason.`);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    violations.push(`${file || '<unknown>'}: createdAt must be ISO date.`);
  }
  if (!lastReviewedAt || Number.isNaN(Date.parse(lastReviewedAt))) {
    violations.push(`${file || '<unknown>'}: lastReviewedAt must be ISO date.`);
  }
  if (!Number.isFinite(reviewCycleDays) || reviewCycleDays < 1) {
    violations.push(`${file || '<unknown>'}: reviewCycleDays must be >= 1.`);
  }
  if (!expiryPolicy) violations.push(`${file || '<unknown>'}: missing expiryPolicy.`);
  if (!status) violations.push(`${file || '<unknown>'}: missing status.`);
  if (status && !allowedStatuses.has(status)) {
    violations.push(`${file || '<unknown>'}: invalid status "${status}".`);
  }
  if (expiryPolicy && !allowedExpiryPolicies.has(expiryPolicy)) {
    violations.push(`${file || '<unknown>'}: invalid expiryPolicy "${expiryPolicy}".`);
  }
  if (!shrinkTarget) violations.push(`${file || '<unknown>'}: missing shrinkTarget.`);
  if (file && !existsSync(join(backendRoot, file))) {
    violations.push(`${file}: lifecycle file path does not exist.`);
  }

  if (lastReviewedAt && Number.isFinite(reviewCycleDays)) {
    const due = Date.parse(lastReviewedAt) + reviewCycleDays * 24 * 60 * 60 * 1000;
    if (now > due) {
      violations.push(
        `${file || '<unknown>'}: review window expired (lastReviewedAt=${lastReviewedAt}, cycle=${reviewCycleDays}d).`,
      );
    }
  }
}

for (const allow of governance.legacyAllowlist ?? []) {
  const file = String(allow.file ?? '').trim();
  const rules = Array.isArray(allow.rules) ? allow.rules : [];
  for (const rule of rules) {
    if (!hasLifecycleCoverage(file, String(rule))) {
      violations.push(`${file}: allowlist rule "${rule}" missing lifecycle governance entry.`);
    }
  }
}

for (const entry of lifecycle.entries ?? []) {
  const file = String(entry.file ?? '').trim();
  const status = String(entry.status ?? '').trim();
  const rules = Array.isArray(entry.rules) ? entry.rules.map((r) => String(r)) : [];
  const allow = (governance.legacyAllowlist ?? []).find((a) => String(a.file ?? '').trim() === file);
  if (!allow) {
    if (status === 'active') {
      violations.push(`${file}: orphan lifecycle entry without allowlist counterpart.`);
    }
    continue;
  }
  const allowRules = new Set((Array.isArray(allow.rules) ? allow.rules : []).map((r) => String(r)));
  for (const rule of rules) {
    if (rule === 'raw-query-call' && !allowRules.has(rule)) {
      continue;
    }
    if (rule !== '*' && !allowRules.has(rule)) {
      violations.push(`${file}: lifecycle rule "${rule}" not present in allowlist.`);
    }
  }
}

if (violations.length > 0) {
  console.error('Query governance lifecycle contract failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-query-governance-lifecycle: OK');
