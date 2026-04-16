#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const repoRoot = dirname(backendRoot);
const contractPath = join(repoRoot, 'contracts', 'feature-flag-governance.contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const violations = [];
for (const entry of contract.frontendRuntimeGuardedFiles ?? []) {
  const file = String(entry.file ?? '').trim();
  if (!file) continue;
  const content = readFileSync(join(repoRoot, file), 'utf8');
  for (const tokenRaw of entry.mustInclude ?? []) {
    const token = String(tokenRaw ?? '').trim();
    if (token && !content.includes(token)) {
      violations.push(`${file}: missing required feature-flag governance token "${token}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('Feature-flag governance contract failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-feature-flag-governance: OK');
