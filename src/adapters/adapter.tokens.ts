/** Bound telephony provider implementation (swappable). */
export const TELEPHONY_PROVIDER = Symbol('TELEPHONY_PROVIDER');

/** Port injected into SMEK for telephony command envelopes. */
export const TELEPHONY_EXECUTION_PORT = Symbol('TELEPHONY_EXECUTION_PORT');
/** Bound AI provider implementation (swappable). */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Port injected into SMEK for AI command envelopes. */
export const AI_EXECUTION_PORT = Symbol('AI_EXECUTION_PORT');
export const APPROVAL_ADAPTER = Symbol('APPROVAL_ADAPTER');
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const PAYMENT_EXECUTION_PORT = Symbol('PAYMENT_EXECUTION_PORT');
export const SYNC_ADAPTER = Symbol('SYNC_ADAPTER');
export const DATA_EXECUTION_PORT = Symbol('DATA_EXECUTION_PORT');
