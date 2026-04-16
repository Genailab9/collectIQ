#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const targets = [
  "app/dashboard/page.tsx",
  "app/observability/page.tsx",
  "app/observability/[correlationId]/page.tsx",
  "app/execution/[correlationId]/page.tsx",
  "app/retries/page.tsx",
];

const violations = [];
for (const rel of targets) {
  const content = readFileSync(join(root, rel), "utf8");
  if (!content.includes("canUsePollingFallback(")) {
    violations.push(`${rel}: missing centralized projection policy usage (canUsePollingFallback).`);
  }
  if (content.includes("stream.sseFailed || !stream.sseConnected")) {
    violations.push(`${rel}: contains inline SSE fallback heuristic (use frontend policy mirror).`);
  }
}

if (violations.length > 0) {
  console.error("Execution projection governance check failed:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log("check-execution-projection-governance: OK");
