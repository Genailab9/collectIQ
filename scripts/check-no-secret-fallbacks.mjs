#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(extname(name))) out.push(p);
  }
  return out;
}

const patterns = [
  /COLLECTIQ_ADMIN_PASSWORD[\s\S]{0,80}\|\|[\s\S]{0,20}['"`][^'"`]+['"`]/,
  /COLLECTIQ_OPERATOR_PASSWORD[\s\S]{0,80}\|\|[\s\S]{0,20}['"`][^'"`]+['"`]/,
  /COLLECTIQ_SESSION_SECRET[\s\S]{0,80}\|\|[\s\S]{0,20}['"`][^'"`]+['"`]/,
  /get\(\s*["'`]COLLECTIQ_ADMIN_PASSWORD["'`]\s*,\s*["'`][^"'`]+["'`]\s*\)/,
  /get\(\s*["'`]COLLECTIQ_OPERATOR_PASSWORD["'`]\s*,\s*["'`][^"'`]+["'`]\s*\)/,
  /get\(\s*["'`]COLLECTIQ_SESSION_SECRET["'`]\s*,\s*["'`][^"'`]+["'`]\s*\)/,
  /NEXT_PUBLIC_.*(?:KEY|SECRET|TOKEN|PASSWORD)/,
];

const files = [
  ...walk(join(root, 'app')),
  ...walk(join(root, 'lib')),
  ...walk(join(root, 'components')),
  ...walk(join(root, 'hooks')),
  ...walk(join(root, 'scripts')),
];
const violations = [];
for (const file of files) {
  const txt = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(txt)) {
      violations.push(file.replace(`${root}/`, ''));
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('Secret fallback guard failed in frontend code:');
  for (const rel of violations) console.error(`  - ${rel}`);
  process.exit(1);
}

console.log('check-no-secret-fallbacks: OK');
