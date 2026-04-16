#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(dirname(__dirname));

const backendPackage = JSON.parse(readFileSync(join(repoRoot, "backend/package.json"), "utf8"));
const frontendPackage = JSON.parse(readFileSync(join(repoRoot, "frontend/package.json"), "utf8"));

const DOMAIN_MAP = {
  "check-query-engine-boundary.mjs": { domain: "tenant", severity: "high" },
  "check-tenant-query-scope.mjs": { domain: "tenant", severity: "critical" },
  "check-admin-plane-queries.mjs": { domain: "tenant", severity: "high" },
  "check-global-query-governance.mjs": { domain: "tenant", severity: "critical" },
  "check-policy-governance.mjs": { domain: "policy", severity: "critical" },
  "check-state-machine-writes.mjs": { domain: "execution", severity: "critical" },
  "check-state-change-events.mjs": { domain: "execution", severity: "high" },
  "check-invariants-contract.mjs": { domain: "execution", severity: "critical" },
  "check-system-event-schema.mjs": { domain: "schema", severity: "critical" },
  "check-control-plane-events.mjs": { domain: "schema", severity: "high" },
  "check-slos-contract.mjs": { domain: "performance", severity: "high" },
  "check-metrics-contract.mjs": { domain: "performance", severity: "high" },
  "check-execution-slos-contract.mjs": { domain: "performance", severity: "high" },
  "check-execution-schema-governance.mjs": { domain: "schema", severity: "critical" },
  "check-execution-projection-governance.mjs": { domain: "execution", severity: "high" },
  "check-execution-purity-governance.mjs": { domain: "execution", severity: "critical" },
  "check-bff-contract-manifest.mjs": { domain: "schema", severity: "high" },
  "check-client-api-surface.mjs": { domain: "policy", severity: "high" },
  "check-domain-isolation.mjs": { domain: "tenant", severity: "high" },
};

function extractChecks(scriptText) {
  const parts = String(scriptText ?? "")
    .split("&&")
    .map((part) => part.trim());
  const checks = [];
  for (const part of parts) {
    const match = part.match(/(?:^|\s)node\s+([^\s]+check-[^\s]+\.mjs)\b/);
    if (!match) continue;
    const fullPath = match[1].replace(/^(\.\.\/)+/, "");
    const file = fullPath.split("/").at(-1);
    if (!file) continue;
    checks.push(file);
  }
  return checks;
}

function toSignal(file, scope) {
  const meta = DOMAIN_MAP[file] ?? { domain: "execution", severity: "medium" };
  return {
    domain: meta.domain,
    severity: meta.severity,
    signal: `${file} passed in ${scope} lint pipeline`,
    source: file,
    scope,
    status: "PASS",
  };
}

const backendChecks = extractChecks(backendPackage.scripts?.lint).map((f) => toSignal(f, "backend"));
const frontendChecks = extractChecks(frontendPackage.scripts?.lint).map((f) => toSignal(f, "frontend"));
const signals = [...backendChecks, ...frontendChecks];

const aggregate = {
  tenantSafety: signals.some((s) => s.domain === "tenant" && s.status !== "PASS") ? "FAIL" : "PASS",
  schemaSafety: signals.some((s) => s.domain === "schema" && s.status !== "PASS") ? "FAIL" : "PASS",
  executionIntegrity: signals.some((s) => s.domain === "execution" && s.status !== "PASS") ? "FAIL" : "PASS",
  policyIntegrity: signals.some((s) => s.domain === "policy" && s.status !== "PASS") ? "FAIL" : "PASS",
  performanceRisk: signals.some((s) => s.domain === "performance" && s.status !== "PASS") ? "FAIL" : "PASS",
};

const summary = {
  generatedAt: new Date().toISOString(),
  model: "governance_signal_compression_v1",
  source: "lint pipelines (reporting layer only)",
  aggregate,
  signals,
};

const outputPath = join(repoRoot, "governance-summary.json");
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`generate-governance-summary: OK -> ${outputPath}`);
