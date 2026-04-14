export class TelephonyCommandUnsupportedError extends Error {
  constructor(public readonly kind: string) {
    super(`Unsupported telephony command kind: "${kind}"`);
    this.name = 'TelephonyCommandUnsupportedError';
    Error.captureStackTrace?.(this, TelephonyCommandUnsupportedError);
  }
}

export class TwilioTelephonyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwilioTelephonyConfigurationError';
    Error.captureStackTrace?.(this, TwilioTelephonyConfigurationError);
  }
}
