#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const allowed = new Set([
  'kernel/smek-kernel.service.ts',
  'state-machine/state-machine.service.ts',
  'state-machine/state-machine.interface.ts',
]);

const illegal = [];
for (const file of walk(root)) {
  const txt = readFileSync(file, 'utf8');
  if (!txt.includes('recordValidatedTransition(')) continue;
  const rel = relative(root, file).replaceAll('\\', '/');
  if (allowed.has(rel)) continue;
  illegal.push(rel);
}

if (illegal.length) {
  console.error('Disallowed recordValidatedTransition() — must go through SMEK kernel only:');
  for (const f of illegal) console.error(`  - src/${f}`);
  process.exit(1);
}
console.log('check-state-machine-writes: OK');
