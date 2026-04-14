export type ComplianceErrorCode = 'COMPLIANCE_BLOCKED' | 'COMPLIANCE_GATE_INVALID';

export abstract class ComplianceError extends Error {
  abstract readonly code: ComplianceErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ComplianceBlockedError extends ComplianceError {
  readonly code: ComplianceErrorCode = 'COMPLIANCE_BLOCKED';

  constructor(
    message: string,
    public readonly blockCode: string,
  ) {
    super(message);
  }
}

export class ComplianceGateInvalidError extends ComplianceError {
  readonly code: ComplianceErrorCode = 'COMPLIANCE_GATE_INVALID';

  constructor(reason: string) {
    super(`Compliance gate input invalid: ${reason}`);
  }
}
