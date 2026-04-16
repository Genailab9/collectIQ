import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);
const script = join(root, "scripts", "check-bff-prefix-lock.mjs");

test("bff prefix lock accepts default config", () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_COLLECTIQ_BFF_PATH: "/api/collectiq" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("bff prefix lock rejects non-collectiq prefix", () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_COLLECTIQ_BFF_PATH: "/api" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /BFF prefix lock failed/i);
});
