export class AiCommandUnsupportedError extends Error {
  constructor(public readonly kind: string) {
    super(`Unsupported AI command kind: "${kind}"`);
    this.name = 'AiCommandUnsupportedError';
    Error.captureStackTrace?.(this, AiCommandUnsupportedError);
  }
}

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigurationError';
    Error.captureStackTrace?.(this, AiConfigurationError);
  }
}

export class AiOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'AiOutputValidationError';
    Error.captureStackTrace?.(this, AiOutputValidationError);
  }
}

export class AiProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AiProviderError';
    Error.captureStackTrace?.(this, AiProviderError);
  }
}
