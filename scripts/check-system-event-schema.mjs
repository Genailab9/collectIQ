#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = dirname(__dirname);

const dtoFile = join(root, 'src/observability/system-event.dto.ts');
const graphFile = join(root, 'src/observability/system-event-graph.service.ts');
const projectionFile = join(root, 'src/observability/system-event-projection.service.ts');
const snapshotFile = join(root, 'src/observability/entities/system-event-integrity-snapshot.entity.ts');
const controllerFile = join(root, 'src/observability/observability.controller.ts');

const dto = readFileSync(dtoFile, 'utf8');
const graph = readFileSync(graphFile, 'utf8');
const projection = readFileSync(projectionFile, 'utf8');
const snapshot = readFileSync(snapshotFile, 'utf8');
const controller = readFileSync(controllerFile, 'utf8');

const violations = [];
if (!dto.includes('schemaVersion')) {
  violations.push('system-event.dto.ts: missing schemaVersion on SystemEventDto');
}
if (!graph.includes('SYSTEM_EVENT_SCHEMA_VERSION')) {
  violations.push('system-event-graph.service.ts: missing SYSTEM_EVENT_SCHEMA_VERSION constant');
}
if (!projection.includes('schemaVersion')) {
  violations.push('system-event-projection.service.ts: schemaVersion not persisted in projection rows');
}
if (!snapshot.includes('schemaVersion') || !snapshot.includes('hashAlgo')) {
  violations.push('system-event-integrity-snapshot.entity.ts: missing schemaVersion/hashAlgo fields');
}
if (!controller.includes("@Query('limit')") || !controller.includes("@Query('fromSeq')")) {
  violations.push('observability.controller.ts: replay endpoint missing pagination query params');
}
if (!projection.includes('MAX_DECISION_EVENTS')) {
  violations.push('system-event-projection.service.ts: decision trace limit constant missing');
}

if (violations.length > 0) {
  console.error('System event schema guard failed:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-system-event-schema: OK');
