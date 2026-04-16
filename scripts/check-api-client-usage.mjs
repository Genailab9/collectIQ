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
    if (rel.startsWith("scripts/")) continue;
    if (rel.endsWith("hooks/useEventStream.ts")) continue; // SSE streaming transport uses fetch reader flow
    const txt = readFileSync(file, "utf8");
    if (!txt.includes('"use client"') && !txt.includes("'use client'")) continue;
    if (/\bfetch\s*\(/.test(txt)) {
      violations.push(rel);
    }
  }
}

if (violations.length > 0) {
  console.error("API layer guard failed. Client files must use apiClient wrappers instead of raw fetch().");
  for (const rel of violations) {
    console.error(`  - ${rel}`);
  }
  process.exit(1);
}

console.log("check-api-client-usage: OK");
