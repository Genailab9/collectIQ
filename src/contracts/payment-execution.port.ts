import type { AdapterEnvelope } from './adapter-envelope';

export interface PaymentExecutionPort {
  execute(envelope: AdapterEnvelope): Promise<unknown>;
}
