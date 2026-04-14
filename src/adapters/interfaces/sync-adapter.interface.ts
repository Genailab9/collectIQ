import type { AdapterEnvelope } from '../../contracts/adapter-envelope';

export interface SyncAdapter {
  execute(envelope: AdapterEnvelope): Promise<unknown>;
}
