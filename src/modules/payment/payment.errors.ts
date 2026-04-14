export class PaymentIdRequiredError extends Error {
  constructor() {
    super('paymentId is required for all payment operations.');
    this.name = 'PaymentIdRequiredError';
    Error.captureStackTrace?.(this, PaymentIdRequiredError);
  }
}

export class PaymentIntentNotFoundError extends Error {
  constructor(paymentId: string) {
    super(`Payment intent not found: ${paymentId}`);
    this.name = 'PaymentIntentNotFoundError';
    Error.captureStackTrace?.(this, PaymentIntentNotFoundError);
  }
}

export class PaymentStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentStateConflictError';
    Error.captureStackTrace?.(this, PaymentStateConflictError);
  }
}

export class PaymentIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentIdempotencyConflictError';
    Error.captureStackTrace?.(this, PaymentIdempotencyConflictError);
  }
}

export class PaymentIdempotencyRequiredError extends Error {
  constructor() {
    super('idempotencyKey is required for all payment mutations (PRD §7).');
    this.name = 'PaymentIdempotencyRequiredError';
    Error.captureStackTrace?.(this, PaymentIdempotencyRequiredError);
  }
}

export class PaymentDuplicateInProgressError extends Error {
  constructor() {
    super('A confirm operation is already in progress for this payment; duplicate blocked (PRD §7).');
    this.name = 'PaymentDuplicateInProgressError';
    Error.captureStackTrace?.(this, PaymentDuplicateInProgressError);
  }
}

export class PaymentGatewayIntentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentGatewayIntentConflictError';
    Error.captureStackTrace?.(this, PaymentGatewayIntentConflictError);
  }
}
