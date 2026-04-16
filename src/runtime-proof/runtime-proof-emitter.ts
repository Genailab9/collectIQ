import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type RuntimeProofEventType =
  | 'API_HIT'
  | 'WORKER_EXECUTION'
  | 'DB_MUTATION'
  | 'AUTH_EVENT'
  | 'ERROR_STATE';

export type RuntimeProof = {
  requirement_id: string;
  event_type: RuntimeProofEventType;
  timestamp: string;
  tenant_id: string;
  metadata: Record<string, unknown>;
};

const proofsDir = join(process.cwd(), 'runtime');
const proofsFile = join(proofsDir, 'proofs.log');

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Best-effort append-only proof logging.
 * Must never throw into business execution paths.
 */
export function emitRuntimeProof(event: Omit<RuntimeProof, 'timestamp'>): void {
  const proof: RuntimeProof = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  const line = `${JSON.stringify(proof)}\n`;
  writeQueue = writeQueue
    .then(async () => {
      await mkdir(proofsDir, { recursive: true });
      await appendFile(proofsFile, line, 'utf8');
    })
    .catch(() => {
      // Non-blocking by design. Compiler reports missing proofs.
    });
}

