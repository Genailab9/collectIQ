#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const contract = JSON.parse(readFileSync(join(root, "contracts/execution-slos.contract.json"), "utf8"));
const telemetry = readFileSync(join(root, "lib/execution-telemetry.ts"), "utf8");
const eventStream = readFileSync(join(root, "hooks/useEventStream.ts"), "utf8");
const pollingPolicy = readFileSync(join(root, "hooks/usePollingPolicy.ts"), "utf8");
const executionStoreHook = readFileSync(join(root, "lib/use-execution-store.ts"), "utf8");

const violations = [];
if (!Array.isArray(contract.slos) || contract.slos.length === 0) {
  violations.push("contracts/execution-slos.contract.json: slos must be non-empty array.");
}

for (const slo of contract.slos ?? []) {
  const id = String(slo.id ?? "").trim();
  const metric = String(slo.metric ?? "").trim();
  const op = String(slo.target?.operator ?? "").trim();
  const value = Number(slo.target?.value);
  if (!id) violations.push("SLO entry missing id.");
  if (!metric) violations.push(`${id || "<unknown>"}: missing metric.`);
  if (!telemetry.includes(`"${metric}"`)) {
    violations.push(`${id || "<unknown>"}: metric "${metric}" missing in frontend telemetry registry.`);
  }
  if (!["<=", "<", ">=", ">", "="].includes(op)) {
    violations.push(`${id || "<unknown>"}: unsupported target.operator "${op}".`);
  }
  if (!Number.isFinite(value)) {
    violations.push(`${id || "<unknown>"}: target.value must be numeric.`);
  }
}

if (!eventStream.includes("recordProjectionLagMs(") || !eventStream.includes("recordSseReconnect(")) {
  violations.push("hooks/useEventStream.ts: missing projection lag or SSE reconnect telemetry emission.");
}
if (!pollingPolicy.includes("recordPollingFallbackActivated(")) {
  violations.push("hooks/usePollingPolicy.ts: missing polling fallback telemetry emission.");
}
if (!executionStoreHook.includes("recordStaleSnapshotMinutes(")) {
  violations.push("lib/use-execution-store.ts: missing stale snapshot telemetry emission.");
}

if (violations.length > 0) {
  console.error("Execution SLO contract check failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("check-execution-slos-contract: OK");
