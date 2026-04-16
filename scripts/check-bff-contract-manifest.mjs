#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import bffContract from "../config/bff-contract.json" with { type: "json" };

const root = fileURLToPath(new URL("..", import.meta.url));
const appRoot = join(root, "app");
const componentsRoot = join(root, "components");
const libRoot = join(root, "lib");
const hooksRoot = join(root, "hooks");
const collectiqApiRoot = join(root, "app", "api", "collectiq");
const mode = String(process.env.COLLECTIQ_CONTRACT_CHECK_MODE ?? "enforce").trim().toLowerCase();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && [".ts", ".tsx", ".js", ".jsx"].includes(extname(name))) out.push(p);
  }
  return out;
}

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

function routePatternToRegex(routePattern) {
  const escaped = routePattern
    .split("/")
    .map((seg) => {
      if (/^\[[^/]+\]$/.test(seg)) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function isAllowedBackendPath(path) {
  if (bffContract.allowedBackendExact.includes(path)) return true;
  return bffContract.allowedBackendPrefixes.some((prefix) => path.startsWith(prefix));
}

function discoverExplicitCollectiqRoutes() {
  const routeFiles = walk(collectiqApiRoot).filter((f) => f.endsWith("/route.ts"));
  const out = [];
  for (const file of routeFiles) {
    if (file.includes("[[...path]]")) continue;
    const rel = relative(collectiqApiRoot, file).replace(/\\/g, "/");
    const routePath = `/${rel.replace(/\/route\.ts$/, "")}`;
    out.push(routePath);
  }
  return out.sort();
}

function checkExplicitRouteManifest(violations) {
  const actual = new Set(discoverExplicitCollectiqRoutes());
  const expected = new Set(bffContract.explicitCollectiqRoutes);

  for (const route of [...actual].sort()) {
    if (!expected.has(route)) {
      violations.push({
        kind: "manifest-missing-route",
        detail: `Route exists but not in manifest: ${route}`,
      });
    }
  }
  for (const route of [...expected].sort()) {
    if (!actual.has(route)) {
      violations.push({
        kind: "manifest-stale-route",
        detail: `Manifest route missing in app/api/collectiq: ${route}`,
      });
    }
  }
}

function checkClientApiUsage(violations) {
  const explicitRouteMatchers = bffContract.explicitCollectiqRoutes.map(routePatternToRegex);
  const files = [...walk(appRoot), ...walk(componentsRoot), ...walk(libRoot), ...walk(hooksRoot)];

  for (const file of files) {
    const txt = readFileSync(file, "utf8");
    if (!txt.includes('"use client"') && !txt.includes("'use client'")) continue;
    const fetchRegex = /fetch\s*\(\s*(['"`])([^'"`]+)\1/g;
    const axiosRegex = /\b(?:axios|apiClient)\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(\s*(['"`])([^'"`]+)\1/g;
    let m;
    const checkPath = (path, index) => {
      if (!path.startsWith("/api/")) return;
      const relFile = file.replace(`${root}/`, "");
      const line = lineForIndex(txt, index);

      if (!path.startsWith(bffContract.browserApiPrefix)) {
        violations.push({
          kind: "client-prefix",
          detail: `${relFile}:${line} uses "${path}" (must start with ${bffContract.browserApiPrefix})`,
        });
        return;
      }

      const backendPath = `/${path.slice(bffContract.browserApiPrefix.length)}`;
      const explicit = explicitRouteMatchers.some((rx) => rx.test(backendPath));
      if (!explicit && !isAllowedBackendPath(backendPath)) {
        violations.push({
          kind: "missing-bff-mapping",
          detail: `${relFile}:${line} uses "${path}" but no explicit collectiq route or allowlisted backend mapping`,
        });
      }
    };
    while ((m = fetchRegex.exec(txt))) {
      checkPath(m[2], m.index);
    }
    while ((m = axiosRegex.exec(txt))) {
      checkPath(m[2], m.index);
    }
  }
}

const violations = [];
checkExplicitRouteManifest(violations);
checkClientApiUsage(violations);

if (violations.length > 0) {
  const header = mode === "enforce" ? "BFF contract enforcement failed." : "BFF contract shadow warnings.";
  const logger = mode === "enforce" ? console.error : console.warn;
  logger(header);
  for (const v of violations) {
    logger(`  - [${v.kind}] ${v.detail}`);
  }
  if (mode === "enforce") {
    process.exit(1);
  }
  console.warn(
    "Shadow mode active: set COLLECTIQ_CONTRACT_CHECK_MODE=enforce to hard-fail CI after route contract is fully green.",
  );
} else {
  console.log(`check-bff-contract-manifest: OK (${mode})`);
}
