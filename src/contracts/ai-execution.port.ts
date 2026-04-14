import type { AdapterEnvelope } from './adapter-envelope';

/**
 * Port injected into SMEK for AI command envelopes. Implementations live outside the kernel.
 */
export interface AiExecutionPort {
  execute(envelope: AdapterEnvelope): Promise<unknown>;
}
