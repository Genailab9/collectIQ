import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);
const backendRoot = dirname(root) + "/backend";

test("governance contract compiler succeeds", () => {
  const result = spawnSync(process.execPath, [join(backendRoot, "scripts", "compile-governance-contracts.mjs")], {
    cwd: backendRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("generated governance artifacts are immutable", () => {
  const result = spawnSync(process.execPath, [join(backendRoot, "scripts", "check-generated-governance-contracts.mjs")], {
    cwd: backendRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("frontend metric sink contract is wired in app shell", () => {
  const contract = JSON.parse(readFileSync(join(root, "config", "policy-client-contract.json"), "utf8"));
  assert.equal(typeof contract.frontendMetricSinkPath, "string");
  assert.ok(contract.frontendMetricSinkPath.startsWith("/api/collectiq/"));

  const shell = readFileSync(join(root, "components", "app-shell.tsx"), "utf8");
  assert.match(shell, /collectiq-frontend-metric/);
  assert.match(shell, /getFrontendMetricSinkPath\(/);
});
