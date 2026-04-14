export class PaymentCommandUnsupportedError extends Error {
  constructor(public readonly kind: string) {
    super(`Unsupported payment command kind: "${kind}"`);
    this.name = 'PaymentCommandUnsupportedError';
    Error.captureStackTrace?.(this, PaymentCommandUnsupportedError);
  }
}

export class PaymentGatewayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentGatewayConfigurationError';
    Error.captureStackTrace?.(this, PaymentGatewayConfigurationError);
  }
}

export class PaymentGatewayError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PaymentGatewayError';
    Error.captureStackTrace?.(this, PaymentGatewayError);
  }
}
