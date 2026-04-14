import type { AdapterEnvelope } from './adapter-envelope';

export interface DataExecutionPort {
  execute(envelope: AdapterEnvelope): Promise<unknown>;
}
