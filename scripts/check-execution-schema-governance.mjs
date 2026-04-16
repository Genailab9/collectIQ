#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendRoot = dirname(__dirname);
const repoRoot = dirname(frontendRoot);

const contractPath = join(frontendRoot, "contracts/frontend-execution-schema.contract.json");
const normalizerPath = join(frontendRoot, "lib/execution-event-normalizer.ts");
const storePath = join(frontendRoot, "lib/execution-store.ts");
const backendStreamPath = join(repoRoot, "backend/src/events/stream/tenant-event-stream.service.ts");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const normalizer = readFileSync(normalizerPath, "utf8");
const store = readFileSync(storePath, "utf8");
const backendStream = readFileSync(backendStreamPath, "utf8");

const violations = [];

if (!contract.streamSchema || !contract.executionStoreSchema) {
  violations.push("contracts/frontend-execution-schema.contract.json: missing streamSchema or executionStoreSchema.");
}

const acceptedMajor = Number(contract.streamSchema?.acceptedMajor);
if (!Number.isInteger(acceptedMajor) || acceptedMajor <= 0) {
  violations.push("streamSchema.acceptedMajor must be a positive integer.");
}

if (!normalizer.includes("schemaVersion")) {
  violations.push("execution-event-normalizer must validate schemaVersion.");
}
if (!normalizer.includes("EXPECTED_SCHEMA_MAJOR")) {
  violations.push("execution-event-normalizer must enforce accepted schema major.");
}
if (!normalizer.includes("if (!eventType) return null;")) {
  violations.push("execution-event-normalizer must reject DOMAIN_EVENT without eventType.");
}

for (const field of contract.executionStoreSchema?.requiredCaseFields ?? []) {
  if (!store.includes(`${field}:`)) {
    violations.push(`execution-store.ts missing required case field: ${field}`);
  }
}

const backendVersionMatch = backendStream.match(/EXECUTION_STREAM_SCHEMA_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
if (!backendVersionMatch) {
  violations.push("backend stream must declare EXECUTION_STREAM_SCHEMA_VERSION.");
}
const backendVersion = backendVersionMatch?.[1] ?? "";
const backendMajor = Number(String(backendVersion).split(".")[0] ?? "0");
if (Number.isFinite(backendMajor) && backendMajor !== acceptedMajor) {
  violations.push(
    `schema handshake mismatch: backend major=${backendMajor}, frontend acceptedMajor=${acceptedMajor}.`,
  );
}

if (violations.length > 0) {
  console.error("Execution schema governance check failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("check-execution-schema-governance: OK");
