/**
 * Stable SMEK → telephony adapter command kinds (opaque routing; no provider semantics in core).
 */
export const TelephonyCommandKind = {
  InitiateCall: 'telephony.initiateCall',
  GetStatus: 'telephony.getStatus',
  TerminateCall: 'telephony.terminateCall',
} as const;

export type TelephonyCommandKind =
  (typeof TelephonyCommandKind)[keyof typeof TelephonyCommandKind];
