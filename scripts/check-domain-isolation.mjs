#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const scanRoots = [
  join(root, "components"),
  join(root, "hooks"),
  join(root, "lib"),
];
const ALLOWED_SHARED_DOMAINS = new Set(["ui", "shared"]);
const GOVERNED_DOMAINS = new Set([
  "execution",
  "approval",
  "observability",
  "tenant",
  "system",
  "payment",
  "dashboard",
  "analytics",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && [".ts", ".tsx", ".js", ".jsx"].includes(extname(name))) out.push(p);
  }
  return out;
}

function sourceDomainOf(pathFromRoot) {
  const parts = pathFromRoot.split("/");
  for (const rootFolder of ["components", "hooks", "lib"]) {
    const idx = parts.indexOf(rootFolder);
    if (idx >= 0 && idx + 1 < parts.length) {
      return parts[idx + 1];
    }
  }
  return null;
}

function importedComponentDomain(line) {
  const m = line.match(/from\s+["']@\/components\/([^/"']+)/);
  if (!m) return null;
  return m[1];
}

const violations = [];
const files = [];
for (const scanRoot of scanRoots) {
  files.push(...walk(scanRoot));
}

for (const file of files) {
  const rel = file.replace(`${root}/`, "");
  const sourceDomain = sourceDomainOf(rel);
  if (!sourceDomain || ALLOWED_SHARED_DOMAINS.has(sourceDomain)) continue;
  if (!GOVERNED_DOMAINS.has(sourceDomain)) continue;
  const txt = readFileSync(file, "utf8");
  for (const line of txt.split("\n")) {
    if (!line.includes("from")) continue;
    const targetDomain = importedComponentDomain(line);
    if (!targetDomain) continue;
    if (!GOVERNED_DOMAINS.has(targetDomain)) continue;
    if (targetDomain === sourceDomain) continue;
    if (ALLOWED_SHARED_DOMAINS.has(targetDomain)) continue;
    violations.push(`${rel} -> ${targetDomain}`);
  }
}

if (violations.length > 0) {
  console.error("Domain isolation guard failed. Cross-domain component imports are not allowed.");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log("check-domain-isolation: OK");
