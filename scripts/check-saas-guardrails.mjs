#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = join(fileURLToPath(new URL('..', import.meta.url)), 'src');
const IGNORED_DIRS = new Set(['dist', 'node_modules']);
const IGNORED_FILE_RE = /\.(spec|e2e-spec)\.ts$/;
const IGNORE_HINT = 'collectiq-guardrail-ignore';
const reportWarnings = String(process.env.COLLECTIQ_GUARDRAILS_REPORT_WARN ?? '').trim() === '1';

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

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function addIssue(issues, file, line, rule, detail, severity = 'error') {
  issues.push({ file, line, rule, detail, severity });
}

function scanControllerDbImports(rel, txt, issues) {
  if (!rel.endsWith('.controller.ts')) return;
  if (txt.includes(IGNORE_HINT)) return;
  const dbImport = /from\s+['"](?:typeorm|@nestjs\/typeorm|prisma|@prisma\/client|knex)['"]/g;
  let m;
  while ((m = dbImport.exec(txt))) {
    addIssue(
      issues,
      rel,
      lineNumberForIndex(txt, m.index),
      'architecture.controller-db-access',
      'Controllers cannot import DB clients directly.',
    );
  }
}

function scanConsoleLogs(rel, txt, issues) {
  if (txt.includes(IGNORE_HINT)) return;
  const consoleLog = /console\.log\s*\(/g;
  let m;
  while ((m = consoleLog.exec(txt))) {
    addIssue(
      issues,
      rel,
      lineNumberForIndex(txt, m.index),
      'observability.console-log-ban',
      'Use structured logger instead of console.log.',
    );
  }
}

function scanHeaderOnlyAuth(rel, txt, issues) {
  if (!rel.includes('/modules/')) return;
  if (txt.includes(IGNORE_HINT)) return;
  const suspicious = /if\s*\(\s*req\.headers\[['"][^'"]+['"]\]\s*\)\s*(?:\{|return\s+true)/g;
  let m;
  while ((m = suspicious.exec(txt))) {
    const window = txt.slice(Math.max(0, m.index - 500), Math.min(txt.length, m.index + 500));
    if (/(role|rbac|acl|permission)/i.test(window)) continue;
    addIssue(
      issues,
      rel,
      lineNumberForIndex(txt, m.index),
      'security.header-only-auth',
      'Header-only auth pattern without nearby RBAC/ACL context.',
    );
  }
}

function scanPublishWildcard(rel, txt, issues) {
  if (txt.includes(IGNORE_HINT)) return;
  const wildcardPublish = /(publish|emit)\s*\(\s*['"`]\*['"`]/g;
  let m;
  while ((m = wildcardPublish.exec(txt))) {
    addIssue(
      issues,
      rel,
      lineNumberForIndex(txt, m.index),
      'streaming.global-broadcast',
      'Wildcard/global publish channels are forbidden.',
    );
  }
}

function scanRawSqlTenantScope(rel, txt, issues) {
  if (txt.includes(IGNORE_HINT)) return;
  if (rel.includes('/health/')) return;
  const queryCalls = /(?:query|execute)\s*\(\s*([`'"])([\s\S]*?)\1/g;
  let m;
  while ((m = queryCalls.exec(txt))) {
    const sql = m[2];
    if (!/\b(select|update|delete)\b/i.test(sql)) continue;
    if (/^\s*select\s+1\b/i.test(sql)) continue;
    if (/\btenant_id\b|\btenantId\b/i.test(sql)) continue;
    addIssue(
      issues,
      rel,
      lineNumberForIndex(txt, m.index),
      'multitenancy.raw-sql-tenant-scope',
      'Raw SQL mutation/read appears to miss tenant predicate.',
    );
  }
}

function scanMutationEventPair(rel, txt, issues) {
  if (txt.includes(IGNORE_HINT)) return;
  const hasMutation = /\.(update|insert|delete|save)\s*\(/.test(txt);
  if (!hasMutation) return;
  const hasEventSemantics = /(emit|publish|record|executeLoop)\w*\s*\(/.test(txt);
  if (hasEventSemantics) return;
  addIssue(
    issues,
    rel,
    1,
    'events.mutation-without-event',
    'Mutation-heavy file has no obvious event emission or executeLoop usage.',
    'warn',
  );
}

function scanProtectedFlagWrites(rel, txt, issues) {
  if (txt.includes(IGNORE_HINT)) return;
  if (!/(ALLOW_TRACE_FULL|DISABLE_TRACE_FULL|BYPASS_TENANT_ISOLATION)/.test(txt)) return;
  const hasWrite = /(update|insert|save|set|patch)\w*\s*\(/i.test(txt) || /flag/i.test(txt);
  if (!hasWrite) return;
  if (/(role\s*===?\s*['"`](ADMIN|SYSTEM)['"`]|role\s*in\s*\[.*ADMIN)/i.test(txt)) return;
  addIssue(
    issues,
    rel,
    1,
    'security.protected-flag-write',
    'Protected flag touched without explicit ADMIN/SYSTEM role check.',
    'warn',
  );
}

function scanDbCallsInLoops(rel, txt, issues) {
  if (txt.includes(IGNORE_HINT)) return;
  const loopWithAwaitedRepo = /(for\s*\(|for\s+await\s*\(|while\s*\(|\.map\s*\(.*async)[\s\S]{0,300}await[\s\S]{0,120}\.(find|findOne|query|save|update|insert|delete)\s*\(/g;
  let m;
  while ((m = loopWithAwaitedRepo.exec(txt))) {
    addIssue(
      issues,
      rel,
      lineNumberForIndex(txt, m.index),
      'performance.n-plus-one-db-loop',
      'Potential N+1 pattern: awaited DB call inside loop.',
      'warn',
    );
  }
}

const issues = [];
for (const file of walk(srcRoot)) {
  const rel = `src/${relative(srcRoot, file).replaceAll('\\', '/')}`;
  const txt = readFileSync(file, 'utf8');
  scanControllerDbImports(rel, txt, issues);
  scanConsoleLogs(rel, txt, issues);
  scanHeaderOnlyAuth(rel, txt, issues);
  scanPublishWildcard(rel, txt, issues);
  scanRawSqlTenantScope(rel, txt, issues);
  scanMutationEventPair(rel, txt, issues);
  scanProtectedFlagWrites(rel, txt, issues);
  scanDbCallsInLoops(rel, txt, issues);
}

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity !== 'error');

if (errors.length > 0 || (reportWarnings && warnings.length > 0)) {
  console.error('CollectIQ SaaS guardrails reported findings:');
  const toReport = reportWarnings ? issues : errors;
  for (const issue of toReport) {
    const level = issue.severity === 'error' ? 'ERROR' : 'WARN';
    console.error(`  - [${level}] [${issue.rule}] ${issue.file}:${issue.line} ${issue.detail}`);
  }
  console.error(
    `\nTo suppress a proven false-positive, add "${IGNORE_HINT}" near the relevant code with rationale.`,
  );
}

if (errors.length > 0) {
  process.exit(1);
}

if (warnings.length > 0 && reportWarnings) {
  console.log(`check-saas-guardrails: WARN (${warnings.length} advisory findings)`);
} else {
  console.log('check-saas-guardrails: OK');
}
