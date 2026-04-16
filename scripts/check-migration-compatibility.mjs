#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = dirname(__dirname);
const repoRoot = dirname(backendRoot);
const migrationsRoot = join(backendRoot, 'src', 'migrations');
const contractPath = join(repoRoot, 'contracts', 'migration-compat.contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const forbiddenPatterns = (contract.forbiddenPatterns ?? []).map((p) => String(p).toUpperCase());
const forbiddenPatternSet = new Set(forbiddenPatterns);
const allowOverrideToken = String(contract.allowOverrideToken ?? 'ALLOW_BREAKING_MIGRATION');
const enforceFrom = Number(contract.enforceFromMigrationTimestamp ?? 0);
const waivers = new Map();
const waiverMeta = new Map();
const reviewByDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const waiverTicketPattern = /^CHG-\d{4}-\d{3,}$/;
for (const w of contract.waivers ?? []) {
  const file = String(w.file ?? '').trim();
  if (!file) continue;
  const owner = String(w.owner ?? '').trim();
  const reviewBy = String(w.reviewBy ?? '').trim();
  const approvalTicket = String(w.approvalTicket ?? '').trim();
  const reason = String(w.reason ?? '').trim();
  const patterns = (w.patterns ?? []).map((p) => String(p ?? '').trim().toUpperCase()).filter(Boolean);
  if (!owner) {
    throw new Error(`Waiver ${file} is missing required "owner".`);
  }
  if (!existsSync(join(backendRoot, file))) {
    throw new Error(`Waiver ${file} references a missing migration file.`);
  }
  if (!waiverTicketPattern.test(approvalTicket)) {
    throw new Error(`Waiver ${file} must include approvalTicket in CHG-YYYY-NNN format.`);
  }
  if (reason.length < 20) {
    throw new Error(`Waiver ${file} reason must contain at least 20 characters.`);
  }
  if (patterns.length === 0) {
    throw new Error(`Waiver ${file} must include at least one waived pattern.`);
  }
  for (const pattern of patterns) {
    if (!forbiddenPatternSet.has(pattern)) {
      throw new Error(`Waiver ${file} includes unsupported pattern "${pattern}".`);
    }
  }
  if (!reviewByDatePattern.test(reviewBy)) {
    throw new Error(`Waiver ${file} must define "reviewBy" as YYYY-MM-DD.`);
  }
  const reviewTs = Date.parse(`${reviewBy}T23:59:59.000Z`);
  if (!Number.isFinite(reviewTs)) {
    throw new Error(`Waiver ${file} has invalid "reviewBy" value "${reviewBy}".`);
  }
  if (reviewTs < Date.now()) {
    throw new Error(`Waiver ${file} review window expired on ${reviewBy}.`);
  }
  waivers.set(
    file,
    new Set(patterns),
  );
  waiverMeta.set(file, { owner, reviewBy, approvalTicket });
}

const violations = [];
for (const file of readdirSync(migrationsRoot)) {
  if (!file.endsWith('.ts')) continue;
  const rel = `src/migrations/${file}`;
  const tsMatch = /^(\d+)-/.exec(file);
  const migrationTs = Number(tsMatch?.[1] ?? 0);
  if (Number.isFinite(enforceFrom) && enforceFrom > 0 && migrationTs < enforceFrom) {
    continue;
  }
  const content = readFileSync(join(migrationsRoot, file), 'utf8');
  const upper = content.toUpperCase();
  if (!content.includes('async up(') || !content.includes('async down(')) {
    violations.push(`${rel}: migration must define both up and down methods.`);
  }
  if (content.includes(allowOverrideToken)) {
    continue;
  }
  for (const pattern of forbiddenPatterns) {
    if (upper.includes(pattern)) {
      const waived = waivers.get(rel)?.has(pattern) === true;
      if (!waived) {
        violations.push(`${rel}: contains forbidden migration operation "${pattern}" (add override token if deliberate).`);
      } else if (!waiverMeta.has(rel)) {
        violations.push(`${rel}: waiver metadata missing for pattern "${pattern}".`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Migration compatibility guard failed:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-migration-compatibility: OK');
