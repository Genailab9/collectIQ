#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const contractPath = join(backendRoot, 'contracts', 'execution-endpoint-guards.contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const violations = [];
for (const entry of contract.controllers ?? []) {
  const file = String(entry.file ?? '').trim();
  if (!file) continue;
  const abs = join(backendRoot, file);
  const content = readFileSync(abs, 'utf8');
  for (const required of entry.mustInclude ?? []) {
    const token = String(required ?? '').trim();
    if (token && !content.includes(token)) {
      violations.push(`${file}: missing required guard token "${token}"`);
    }
  }
  for (const forbidden of entry.mustNotInclude ?? []) {
    const token = String(forbidden ?? '').trim();
    if (token && content.includes(token)) {
      violations.push(`${file}: forbidden token present "${token}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('Execution endpoint guard contract failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-execution-endpoint-guards: OK');
