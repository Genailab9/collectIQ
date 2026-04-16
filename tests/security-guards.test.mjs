import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

function run(scriptName) {
  return spawnSync(process.execPath, [join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf8",
  });
}

test("secret fallback guard passes", () => {
  const result = run("check-no-secret-fallbacks.mjs");
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("client api surface guard passes", () => {
  const result = run("check-client-api-surface.mjs");
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
