#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);
const srcRoot = join(root, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && name.endsWith('-transition-query.service.ts')) out.push(p);
  }
  return out;
}

const targetFiles = walk(srcRoot).map((file) => relative(root, file).replaceAll('\\', '/')).sort();
const violations = [];

for (const rel of targetFiles) {
  const content = readFileSync(join(root, rel), 'utf8');
  const hasTenantEngine = content.includes('tenantQueryEngine.query(');
  const hasAdminOrSystemEngine =
    content.includes('adminQueryEngine.query(') || content.includes('systemQueryEngine.query(');
  const hasCrossTenantScopeUsage = content.includes('withCrossTenantScope(');

  if (content.includes('.createQueryBuilder(')) {
    violations.push(`${rel}: direct createQueryBuilder usage is forbidden (use query engines).`);
  }
  if (content.includes('tenantQueryScope.forRepo(') || content.includes('tenantQueryScope.withCrossTenantScope(')) {
    violations.push(`${rel}: direct TenantQueryScopeService usage is forbidden (use query engines).`);
  }
  if (!hasTenantEngine && !hasAdminOrSystemEngine) {
    violations.push(`${rel}: missing query engine usage (Tenant/Admin/SystemQueryEngine).`);
  }
  if (hasCrossTenantScopeUsage && !hasAdminOrSystemEngine) {
    violations.push(`${rel}: cross-tenant scope requires AdminQueryEngine or SystemQueryEngine.`);
  }
}

if (violations.length > 0) {
  console.error('Query engine boundary guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log(`check-query-engine-boundary: OK (${targetFiles.length} transition query services)`);
