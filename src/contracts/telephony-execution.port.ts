import type { AdapterEnvelope } from './adapter-envelope';

/**
 * Narrow port injected into SMEK. Provider-specific implementations live outside the kernel.
 */
export interface TelephonyExecutionPort {
  execute(envelope: AdapterEnvelope): Promise<unknown>;
}
