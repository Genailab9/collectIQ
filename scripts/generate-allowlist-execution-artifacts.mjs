#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(dirname(__dirname));

const governancePath = join(repoRoot, "backend/contracts/query-governance.contract.json");
const lifecyclePath = join(repoRoot, "backend/contracts/query-governance.lifecycle.contract.json");
const cacheDir = join(repoRoot, "runtime");
const cachePath = join(cacheDir, "allowlist-velocity-cache.json");

const governance = JSON.parse(readFileSync(governancePath, "utf8"));
const lifecycle = JSON.parse(readFileSync(lifecyclePath, "utf8"));
const nowIso = new Date().toISOString();
const nowMs = Date.parse(nowIso);

const RULE_WEIGHT = {
  "direct-query-builder": 5,
  "raw-query-call": 5,
  "direct-data-source": 5,
  "direct-tenant-scope": 4,
  "inject-repository": 2,
  "*": 6,
};

function moduleWeight(file) {
  if (/kernel|tenant\/tenant-correlation-resolver|state-machine/.test(file)) return 5;
  if (/observability|read-model|recovery|survival/.test(file)) return 4;
  if (/payment|approval|sync|telephony/.test(file)) return 3;
  return 2;
}

function ownerFrom(entry) {
  return String(entry.owner ?? "unassigned").trim() || "unassigned";
}

function effortFromScore(score) {
  if (score >= 13) return "large";
  if (score >= 9) return "medium";
  return "small";
}

function riskTierFromScore(score) {
  if (score >= 13) return "high";
  if (score >= 9) return "medium";
  return "low";
}

function migrationHint(entry) {
  return String(entry.shrinkTarget ?? "migrate to query engine boundary").trim();
}

function domainFromFile(file) {
  if (file.includes("observability") || file.includes("read-model")) return "observability";
  if (file.includes("recovery") || file.includes("survival")) return "recovery";
  if (file.includes("kernel") || file.includes("state-machine")) return "kernel";
  if (file.includes("tenant")) return "tenant";
  if (file.includes("payment")) return "payments";
  if (file.includes("approval")) return "approval";
  if (file.includes("sync")) return "sync";
  if (file.includes("telephony")) return "telephony";
  return "platform";
}

function normalizeFilePath(file) {
  return String(file).replace(/^src\/src\//, "src/").trim();
}

function toIsoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dependsOnFor(file) {
  const deps = [];
  if (/read-model|observability|recovery|survival/.test(file)) deps.push("B1");
  if (/tenant-correlation-resolver/.test(file)) deps.push("B1");
  return deps;
}

const lifecycleMap = new Map(
  (lifecycle.entries ?? []).map((entry) => [String(entry.file ?? "").trim(), entry]),
);

const flatEntries = (governance.legacyAllowlist ?? [])
  .map((entry) => {
    const file = String(entry.file ?? "").trim();
    const rules = Array.isArray(entry.rules) ? entry.rules : [];
    const lifecycleEntry = lifecycleMap.get(file) ?? {};
    const ruleWeight = rules.reduce((sum, rule) => sum + (RULE_WEIGHT[rule] ?? 1), 0);
    const score = ruleWeight + moduleWeight(file);
    return {
      file,
      rule: rules.join(","),
      reason: String(lifecycleEntry.reason ?? "Legacy allowlist surface").trim(),
      owner: ownerFrom(lifecycleEntry),
      migrationHint: migrationHint(lifecycleEntry),
      score,
      riskTier: riskTierFromScore(score),
      estimatedEffort: effortFromScore(score),
      domain: domainFromFile(file),
      dependsOn: dependsOnFor(file),
      lastReviewedAt: String(lifecycleEntry.lastReviewedAt ?? "").trim(),
    };
  })
  .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

const batchSizeByRisk = { high: 4, medium: 6, low: 8 };
const riskBuckets = {
  high: flatEntries.filter((e) => e.riskTier === "high"),
  medium: flatEntries.filter((e) => e.riskTier === "medium"),
  low: flatEntries.filter((e) => e.riskTier === "low"),
};

const batches = [];
let batchCounter = 1;
for (const tier of ["high", "medium", "low"]) {
  const size = batchSizeByRisk[tier];
  for (let i = 0; i < riskBuckets[tier].length; i += size) {
    const group = riskBuckets[tier].slice(i, i + size);
    batches.push({
      batchId: `B${batchCounter++}`,
      riskTier: tier,
      estimatedEffort:
        group.some((e) => e.estimatedEffort === "large")
          ? "large"
          : group.some((e) => e.estimatedEffort === "medium")
            ? "medium"
            : "small",
      entries: group.map((e) => ({
        file: e.file,
        rule: e.rule,
        reason: e.reason,
        dependsOn: e.dependsOn,
        owner: e.owner,
        migrationHint: e.migrationHint,
      })),
    });
  }
}

const executionPlan = {
  version: "1.0.0",
  generatedAt: nowIso,
  batches,
};
writeFileSync(join(repoRoot, "allowlist-execution-plan.json"), `${JSON.stringify(executionPlan, null, 2)}\n`);

if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
const previousCache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : null;
const currentTotal = flatEntries.length;
const currentWeek = toIsoWeekKey(new Date(nowIso));

const prevTotal = Number(previousCache?.currentTotal ?? currentTotal);
const delta = currentTotal - prevTotal;
const prevGeneratedMs = Number(previousCache?.generatedAtMs ?? nowMs);
const daysBetween = Math.max(1, (nowMs - prevGeneratedMs) / 86_400_000);
const weeklyBurnRate = Number(((-delta / daysBetween) * 7).toFixed(2));
const estimatedWeeksToZero = weeklyBurnRate > 0 ? Math.ceil(currentTotal / weeklyBurnRate) : null;

const ownerCounts = new Map();
for (const entry of flatEntries) {
  ownerCounts.set(entry.owner, (ownerCounts.get(entry.owner) ?? 0) + 1);
}
const topStuckOwners = [...ownerCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 10);

const stagnantCyclesThreshold = 3;
const previousSnapshot = new Set((previousCache?.files ?? []).map(normalizeFilePath));
const unchangedCount = flatEntries.filter((e) => previousSnapshot.has(e.file)).length;
const stagnationDetected =
  Boolean(previousCache?.cyclesWithoutChange ?? 0) >= stagnantCyclesThreshold && delta === 0;
const cyclesWithoutChange = delta === 0 ? Number(previousCache?.cyclesWithoutChange ?? 0) + 1 : 0;

const velocityReport = [
  "# Allowlist Velocity Report",
  "",
  `Date: ${nowIso}`,
  "",
  "## Burn-down velocity",
  `- Total allowlisted: ${currentTotal}`,
  `- Delta vs last run: ${delta >= 0 ? "+" : ""}${delta}`,
  `- Weekly burn rate: ${weeklyBurnRate >= 0 ? "-" : "+"}${Math.abs(weeklyBurnRate)}`,
  `- Estimated full convergence: ${estimatedWeeksToZero == null ? "n/a (no positive burn rate yet)" : `${estimatedWeeksToZero} weeks`}`,
  "",
  "## Stagnation",
  `- Cycles without change: ${cyclesWithoutChange}`,
  `- Unchanged surfaces vs last run: ${unchangedCount}`,
  `- Stagnation detected (>3 cycles unchanged): ${stagnationDetected ? "yes" : "no"}`,
  "",
  "## Top 10 stuck owners/modules",
  ...topStuckOwners.map(([owner, count]) => `- ${owner}: ${count}`),
  "",
  "## Weekly marker",
  `- Snapshot week: ${currentWeek}`,
].join("\n");
writeFileSync(join(repoRoot, "allowlist-velocity-report.md"), `${velocityReport}\n`);

const groupedByBatch = batches.map((batch) => {
  const owners = new Set(batch.entries.map((e) => e.owner));
  const domains = new Set(
    batch.entries.map((e) => {
      const original = flatEntries.find((x) => x.file === e.file);
      return original?.domain ?? "platform";
    }),
  );
  return {
    ...batch,
    ownerSummary: [...owners].sort(),
    domainSummary: [...domains].sort(),
  };
});

const prBatchesReport = [
  "# Allowlist PR Batches",
  "",
  `Generated: ${nowIso}`,
  "",
  ...groupedByBatch.flatMap((batch) => [
    `### Batch ${batch.batchId} (${batch.riskTier.toUpperCase()} Priority - ${batch.domainSummary.join(", ")})`,
    `- ${batch.entries.length} allowlist entries`,
    `- Owners: ${batch.ownerSummary.join(", ")}`,
    `- Estimated effort: ${batch.estimatedEffort}`,
    "",
    "PR scope:",
    ...batch.entries.map((entry) => `- ${entry.file} (${entry.rule})`),
    "",
  ]),
].join("\n");
writeFileSync(join(repoRoot, "allowlist-pr-batches.md"), `${prBatchesReport}\n`);

const nextCache = {
  version: 1,
  generatedAt: nowIso,
  generatedAtMs: nowMs,
  currentTotal,
  files: flatEntries.map((e) => e.file),
  cyclesWithoutChange,
};
writeFileSync(cachePath, `${JSON.stringify(nextCache, null, 2)}\n`);

console.log("generate-allowlist-execution-artifacts: OK");
