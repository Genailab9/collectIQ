#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bffContract from "../config/bff-contract.json" with { type: "json" };

const root = fileURLToPath(new URL("..", import.meta.url));
const appRoot = join(root, "app");
const componentsRoot = join(root, "components");
const libRoot = join(root, "lib");
const hooksRoot = join(root, "hooks");
const ALLOWED_PREFIX = bffContract.browserApiPrefix;

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

function checkFile(file, violations) {
  const txt = readFileSync(file, "utf8");
  if (!txt.includes('"use client"') && !txt.includes("'use client'")) return;

  const fetchRegex = /fetch\s*\(\s*(['"`])([^'"`]+)\1/g;
  const axiosRegex = /\b(?:axios|apiClient)\s*\.\s*(?:get|post|put|patch|delete|request)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let m;
  while ((m = fetchRegex.exec(txt))) {
    const path = m[2];
    if (!path.startsWith("/api/")) continue;
    if (path.startsWith(ALLOWED_PREFIX)) continue;
    violations.push({
      file: file.replace(`${root}/`, ""),
      line: lineForIndex(txt, m.index),
      path,
    });
  }

  while ((m = axiosRegex.exec(txt))) {
    const path = m[2];
    if (!path.startsWith("/api/")) continue;
    if (path.startsWith(ALLOWED_PREFIX)) continue;
    violations.push({
      file: file.replace(`${root}/`, ""),
      line: lineForIndex(txt, m.index),
      path,
    });
  }
}

const violations = [];
for (const file of [...walk(appRoot), ...walk(componentsRoot), ...walk(libRoot), ...walk(hooksRoot)]) {
  checkFile(file, violations);
}

if (violations.length > 0) {
  console.error("Client API surface enforcement failed.");
  console.error(`All client-side fetch/axios/apiClient calls must target ${ALLOWED_PREFIX}*`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} uses "${v.path}"`);
  }
  process.exit(1);
}

console.log("check-client-api-surface: OK");
