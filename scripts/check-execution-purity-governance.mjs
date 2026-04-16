#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const violations = [];

const executionDetailPath = "app/execution/[correlationId]/page.tsx";
const executionDetail = readFileSync(join(root, executionDetailPath), "utf8");

if (!executionDetail.includes("useExecutionStore()")) {
  violations.push(`${executionDetailPath}: must consume executionStore via useExecutionStore().`);
}
if (executionDetail.includes("traceQuery.data?.transitions")) {
  violations.push(`${executionDetailPath}: local transition-derived execution state is forbidden.`);
}
if (executionDetail.includes("const stateByPhase = useMemo(")) {
  violations.push(`${executionDetailPath}: local memoized execution state derivation is forbidden.`);
}
if (executionDetail.includes("const journeyFlags = useMemo(")) {
  violations.push(`${executionDetailPath}: local memoized execution status flags are forbidden.`);
}

const governedPages = [
  "app/execution/[correlationId]/page.tsx",
  "app/retries/page.tsx",
  "app/observability/[correlationId]/page.tsx",
];

for (const rel of governedPages) {
  const content = readFileSync(join(root, rel), "utf8");
  if (!content.includes("canUsePollingFallback(")) {
    violations.push(`${rel}: missing centralized frontend policy mirror usage (canUsePollingFallback).`);
  }
  if (content.includes("stream.sseFailed || !stream.sseConnected")) {
    violations.push(`${rel}: inline SSE fallback heuristics are forbidden.`);
  }
}

if (violations.length > 0) {
  console.error("Execution purity governance check failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("check-execution-purity-governance: OK");
