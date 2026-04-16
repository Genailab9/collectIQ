#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const repoRoot = dirname(backendRoot);
const srcRoot = join(backendRoot, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && extname(name) === '.ts' && name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const contract = JSON.parse(readFileSync(join(repoRoot, 'contracts/policy.contract.json'), 'utf8'));
const allowedPrefixes = (contract.backend?.controllerPrefixes ?? []).map((x) => String(x).trim());
const violations = [];

for (const file of walk(srcRoot)) {
  const rel = file.replace(`${backendRoot}/`, '');
  const txt = readFileSync(file, 'utf8');
  const m = /@Controller\(([\s\S]*?)\)/m.exec(txt);
  if (!m?.[1]) continue;
  const args = m[1];
  const literals = [...args.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
  for (const route of literals) {
    const normalized = route.trim().replace(/^\/+/, '');
    const covered = allowedPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    );
    if (!covered) {
      violations.push(`${rel}: controller route "${route}" missing from contracts/policy.contract.json backend.controllerPrefixes`);
    }
  }
}

if (violations.length > 0) {
  console.error('Contract route coverage guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-contract-route-coverage: OK');
