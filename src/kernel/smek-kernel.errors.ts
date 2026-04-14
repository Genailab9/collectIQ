export type SmekKernelErrorCode =
  | 'SMEK_STATE_MACHINE_NOT_READY'
  | 'SMEK_COMMAND_STRUCTURAL_INVALID'
  | 'SMEK_ADAPTER_NOT_BOUND'
  | 'SMEK_ADAPTER_ENVELOPE_REQUIRED'
  | 'SMEK_ADAPTER_ENVELOPE_FORBIDDEN'
  | 'SMEK_ORCHESTRATION_AUDIT_FAILED'
  | 'SMEK_APPROVAL_ADAPTER_ENVELOPE_DISALLOWED';

export abstract class SmekKernelError extends Error {
  abstract readonly code: SmekKernelErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class SmekStateMachineNotReadyError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_STATE_MACHINE_NOT_READY';

  constructor() {
    super('SMEK cannot execute: state machine engine is not ready.');
  }
}

export class SmekCommandStructuralError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_COMMAND_STRUCTURAL_INVALID';

  constructor(reason: string) {
    super(`SMEK cannot execute: invalid command structure (${reason}).`);
  }
}

export class SmekAdapterNotBoundError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_ADAPTER_NOT_BOUND';

  constructor(public readonly adapterToken: string) {
    super(`SMEK cannot execute: required adapter "${adapterToken}" is not bound in the DI container.`);
  }
}

export class SmekAdapterEnvelopeRequiredError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_ADAPTER_ENVELOPE_REQUIRED';

  constructor(public readonly phase: string) {
    super(`SMEK cannot execute: adapter envelope is required for phase "${phase}".`);
  }
}

export class SmekAdapterEnvelopeForbiddenError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_ADAPTER_ENVELOPE_FORBIDDEN';

  constructor(public readonly phase: string) {
    super(`SMEK cannot execute: adapter envelope is forbidden for phase "${phase}".`);
  }
}

export class SmekOrchestrationAuditError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_ORCHESTRATION_AUDIT_FAILED';

  constructor(cause: unknown) {
    const detail =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown';
    super(`SMEK orchestration audit persistence failed: ${detail}`);
  }
}

/**
 * APPROVE transitions are applied via `approvalIngress` (no adapter envelope). An adapter
 * envelope on APPROVE is a wiring mistake and must not silently succeed.
 */
export class SmekApprovalAdapterEnvelopeDisallowedError extends SmekKernelError {
  readonly code: SmekKernelErrorCode = 'SMEK_APPROVAL_ADAPTER_ENVELOPE_DISALLOWED';

  constructor() {
    super(
      'SMEK cannot execute: APPROVE phase does not support adapter envelopes; use approvalIngress.',
    );
  }
}

