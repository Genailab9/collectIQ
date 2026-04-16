#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const targets = [
  {
    file: 'src/saas/saas-tenant.service.ts',
    method: 'async listAll(',
  },
];

const violations = [];
for (const t of targets) {
  const path = join(root, t.file);
  const txt = readFileSync(path, 'utf8');
  const idx = txt.indexOf(t.method);
  if (idx < 0) {
    violations.push(`${t.file}: method "${t.method.trim()}" not found`);
    continue;
  }
  const windowStart = Math.max(0, idx - 200);
  const window = txt.slice(windowStart, idx);
  if (!window.includes('@AdminPlaneQuery()')) {
    violations.push(`${t.file}: ${t.method.trim()} must be annotated with @AdminPlaneQuery()`);
  }
}

if (violations.length > 0) {
  console.error('Admin-plane query guard failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-admin-plane-queries: OK');
