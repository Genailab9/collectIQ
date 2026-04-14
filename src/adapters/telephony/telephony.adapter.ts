import type {
  GetCallStatusInput,
  GetCallStatusResult,
  InitiateCallInput,
  InitiateCallResult,
  TerminateCallInput,
  TerminateCallResult,
} from './telephony.types';

/**
 * Swappable telephony provider port. Implementations MUST live under provider-specific modules
 * (e.g. `twilio/`) and MUST NOT be imported by the SMEK kernel.
 */
export interface TelephonyAdapter {
  initiateCall(input: InitiateCallInput): Promise<InitiateCallResult>;
  getStatus(input: GetCallStatusInput): Promise<GetCallStatusResult>;
  terminateCall(input: TerminateCallInput): Promise<TerminateCallResult>;
}
