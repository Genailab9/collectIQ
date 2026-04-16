#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);
const srcRoot = join(root, 'src');
const mode = String(process.env.COLLECTIQ_QUERY_GOVERNANCE_MODE ?? 'shadow').trim().toLowerCase();
const contractPath = join(root, 'contracts', 'query-governance.contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const IGNORED_DIRS = new Set(['dist', 'node_modules', 'migrations']);
const IGNORED_FILE_RE =
  /\.(spec|e2e-spec)\.ts$/;

const ALLOWLIST = [
  'src/tenant/query-engines/',
  'src/tenant/tenant-query-scope.service.ts',
  'src/database/',
  'src/cli/',
  'src/migrations/',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && extname(name) === '.ts' && !IGNORED_FILE_RE.test(name)) out.push(p);
  }
  return out;
}

function isCandidate(rel) {
  if (ALLOWLIST.some((prefix) => rel.startsWith(prefix))) return false;
  return (
    rel.endsWith('.service.ts') ||
    rel.endsWith('.worker.ts') ||
    rel.endsWith('.bridge.ts') ||
    rel.endsWith('.resolver.ts')
  );
}

function classifyOwnership(rel, text) {
  if (/admin|saas|system/i.test(rel) || text.includes('@AdminPlaneQuery()')) return 'admin';
  if (/recovery|worker|survival|kernel|observability|health|simulation/i.test(rel)) return 'system';
  if (text.includes('tenantId') || /tenant/i.test(rel)) return 'tenant';
  return 'tenant';
}

function lineForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function readCalleeIdentifier(text, dotIndex) {
  let i = dotIndex - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  let end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(text[i])) i -= 1;
  return text.slice(i + 1, end);
}

const findings = [];
for (const file of walk(srcRoot)) {
  const rel = `src/${relative(srcRoot, file).replaceAll('\\', '/')}`;
  if (!isCandidate(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const ownership = classifyOwnership(rel, text);
  const checks = [
    { rule: 'direct-query-builder', regex: /\.createQueryBuilder\s*\(/g, detail: 'direct createQueryBuilder usage' },
    { rule: 'raw-query-call', regex: /\.query\s*\(/g, detail: 'direct raw query() usage' },
    { rule: 'direct-data-source', regex: /\bdataSource\./g, detail: 'direct DataSource usage' },
    {
      rule: 'direct-tenant-scope',
      regex: /tenantQueryScope\.(forRepo|withCrossTenantScope)\s*\(/g,
      detail: 'direct TenantQueryScopeService usage',
    },
    { rule: 'inject-repository', regex: /@InjectRepository\s*\(/g, detail: 'direct repository injection' },
  ];
  for (const check of checks) {
    let m;
    while ((m = check.regex.exec(text))) {
      if (check.rule === 'raw-query-call') {
        const callee = readCalleeIdentifier(text, m.index);
        if (
          callee === 'tenantQueryEngine' ||
          callee === 'adminQueryEngine' ||
          callee === 'systemQueryEngine'
        ) {
          continue;
        }
      }
      findings.push({
        file: rel,
        line: lineForIndex(text, m.index),
        rule: check.rule,
        detail: check.detail,
        ownership,
      });
    }
  }
}

function isAllowlistedFinding(finding) {
  for (const entry of contract.legacyAllowlist ?? []) {
    if (String(entry.file ?? '').trim() !== finding.file) continue;
    const rules = Array.isArray(entry.rules) ? entry.rules : [];
    if (rules.includes('*') || rules.includes(finding.rule)) {
      return true;
    }
  }
  return false;
}

const allowlisted = findings.filter((f) => isAllowlistedFinding(f));
const actionable = findings.filter((f) => !isAllowlistedFinding(f));
const maxAllowlisted = Number(contract.maxAllowlistedFindings);
const enforceAllowlistBudget = Number.isFinite(maxAllowlisted) && maxAllowlisted >= 0;

if (findings.length === 0) {
  console.log('check-global-query-governance: OK (no direct ORM boundary violations found)');
  process.exit(0);
}

console.warn(
  `check-global-query-governance: total=${findings.length} allowlisted=${allowlisted.length} actionable=${actionable.length} mode=${mode}`,
);
for (const f of actionable) {
  console.warn(
    `  - [${f.rule}] ${f.file}:${f.line} ${f.detail} (suggested_engine=${f.ownership.toUpperCase()}_QUERY_ENGINE)`,
  );
}

if (mode === 'enforce') {
  if (enforceAllowlistBudget && allowlisted.length > maxAllowlisted) {
    console.error(
      `Allowlist budget exceeded: allowlisted=${allowlisted.length} budget=${maxAllowlisted}.`,
    );
    console.error('Reduce legacy findings or explicitly adjust contract budget with review.');
    process.exit(1);
  }
  if (actionable.length === 0) {
    const budgetMsg = enforceAllowlistBudget
      ? ` allowlist_budget=${allowlisted.length}/${maxAllowlisted}`
      : '';
    console.log(`Global query governance enforce mode: OK (no actionable findings).${budgetMsg}`);
    process.exit(0);
  }
  console.error(
    'Global query governance is in enforce mode. Migrate findings to query engines or add an explicit legacy allowlist entry.',
  );
  process.exit(1);
}

console.warn(
  'Shadow mode active: set COLLECTIQ_QUERY_GOVERNANCE_MODE=enforce to hard-fail query governance violations.',
);
