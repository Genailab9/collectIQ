#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const repoRoot = dirname(backendRoot);

const contractPath = join(repoRoot, 'contracts', 'invariants.contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const violations = [];
const results = [];

for (const inv of contract.invariants ?? []) {
  const invariantId = String(inv.id ?? '').trim();
  const validator = inv.validator ?? {};
  const validatorType = String(validator.type ?? '').trim();
  const validatorPathRel = String(validator.path ?? '').trim();
  if (!invariantId) {
    violations.push('Invariant entry missing id.');
    continue;
  }
  if (validatorType !== 'node_script') {
    violations.push(`${invariantId}: unsupported validator type "${validatorType}" (expected node_script).`);
    continue;
  }
  if (!validatorPathRel) {
    violations.push(`${invariantId}: missing validator.path.`);
    continue;
  }
  const validatorPath = resolve(repoRoot, validatorPathRel);
  if (!existsSync(validatorPath)) {
    violations.push(`${invariantId}: validator file not found at ${validatorPathRel}.`);
    continue;
  }

  const run = spawnSync(process.execPath, [validatorPath], {
    cwd: backendRoot,
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    violations.push(
      `${invariantId}: validator failed (${validatorPathRel})\n${(run.stderr || run.stdout || '').trim()}`,
    );
  } else {
    results.push(`${invariantId}: PASS`);
  }
}

if (violations.length > 0) {
  console.error('Invariant contract validation failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

for (const line of results) {
  console.log(line);
}
console.log('check-invariants-contract: OK');
