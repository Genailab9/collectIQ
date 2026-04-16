import { HttpException, HttpStatus } from '@nestjs/common';

type ErrorMapperContext = {
  correlationId?: string | null;
};

type StructuredErrorResponse = {
  code: string;
  message: string;
  details: unknown;
  correlationId: string;
};

function toCorrelationId(raw?: string | null): string {
  const c = raw?.trim();
  return c && c.length > 0 ? c : 'n/a';
}

function normalizeHttpExceptionPayload(
  error: HttpException,
  correlationId: string,
): StructuredErrorResponse {
  const response = error.getResponse();
  const status = error.getStatus();
  const code = HttpStatus[status] ?? 'HTTP_ERROR';

  if (typeof response === 'string') {
    return {
      code,
      message: response,
      details: null,
      correlationId,
    };
  }

  if (response && typeof response === 'object') {
    const body = response as {
      message?: string | string[];
      error?: string;
      details?: unknown;
      code?: string;
    };
    const message =
      typeof body.message === 'string'
        ? body.message
        : Array.isArray(body.message)
          ? body.message.join('; ')
          : body.error ?? error.message;
    return {
      code: typeof body.code === 'string' && body.code.trim() ? body.code : code,
      message,
      details: body.details ?? (Array.isArray(body.message) ? body.message : null),
      correlationId,
    };
  }

  return {
    code,
    message: error.message,
    details: null,
    correlationId,
  };
}

function isBusinessRuleError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const n = error.name;
  return (
    n.startsWith('Approval') ||
    n.startsWith('Payment') ||
    n.startsWith('Settlement') ||
    n.startsWith('Compliance') ||
    n.startsWith('IllegalStateTransition') ||
    n.startsWith('TerminalStateViolation') ||
    n.startsWith('UnknownState') ||
    n.startsWith('NoopTransition')
  );
}

/**
 * Controller-safe error mapper.
 * - Validation & business rule errors => 400
 * - Unauthorized/forbidden/not-found remain respective status
 * - Unexpected/system failures => 500
 */
export function mapControllerError(error: unknown, ctx: ErrorMapperContext = {}): HttpException {
  const correlationId = toCorrelationId(ctx.correlationId);
  if (error instanceof HttpException) {
    const normalized = normalizeHttpExceptionPayload(error, correlationId);
    return new HttpException(normalized, error.getStatus());
  }

  if (isBusinessRuleError(error)) {
    const body: StructuredErrorResponse = {
      code: 'BUSINESS_RULE_VIOLATION',
      message: error.message || 'Business rule violation.',
      details: { name: error.name },
      correlationId,
    };
    return new HttpException(body, HttpStatus.BAD_REQUEST);
  }

  const body: StructuredErrorResponse = {
    code: 'SYSTEM_FAILURE',
    message: 'Internal server error',
    details: error instanceof Error ? { name: error.name } : null,
    correlationId,
  };
  return new HttpException(body, HttpStatus.INTERNAL_SERVER_ERROR);
}

