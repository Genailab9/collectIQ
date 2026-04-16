#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const scanRoots = [join(root, "app"), join(root, "components"), join(root, "hooks"), join(root, "lib")];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && [".ts", ".tsx", ".js", ".jsx"].includes(extname(name))) out.push(p);
  }
  return out;
}

const violations = [];
for (const base of scanRoots) {
  for (const file of walk(base)) {
    const rel = file.replace(`${root}/`, "");
    if (rel.startsWith("app/api/")) continue;
    const txt = readFileSync(file, "utf8");
    if (!txt.includes("refetchInterval")) continue;
    const usesPolicyHook =
      txt.includes("usePollingPolicy(") &&
      (txt.includes("from \"@/hooks/usePollingPolicy\"") || txt.includes("from '@/hooks/usePollingPolicy'"));
    if (!usesPolicyHook) {
      violations.push(rel);
      continue;
    }
    const hasUseEventStream = txt.includes("useEventStream(") || txt.includes("useGlobalEventStream(");
    const hasSseInputs = txt.includes("sseConnected:") && txt.includes("sseFailed:");
    if (hasUseEventStream && !hasSseInputs) {
      violations.push(`${rel} (missing sseConnected/sseFailed semantic inputs)`);
    }
  }
}

if (violations.length > 0) {
  console.error("Polling policy guard failed. refetchInterval must be controlled by usePollingPolicy.");
  for (const rel of violations) {
    console.error(`  - ${rel}`);
  }
  process.exit(1);
}

console.log("check-polling-policy: OK");
