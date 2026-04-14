export class ApprovalPolicyMissingError extends Error {
  constructor(tenantId: string) {
    super(`No approval policy configured for tenant "${tenantId}".`);
    this.name = 'ApprovalPolicyMissingError';
    Error.captureStackTrace?.(this, ApprovalPolicyMissingError);
  }
}

export class ApprovalOfferInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalOfferInvalidError';
    Error.captureStackTrace?.(this, ApprovalOfferInvalidError);
  }
}

export class ApprovalStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalStateConflictError';
    Error.captureStackTrace?.(this, ApprovalStateConflictError);
  }
}

export class ApprovalTransitionNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalTransitionNotAllowedError';
    Error.captureStackTrace?.(this, ApprovalTransitionNotAllowedError);
  }
}
