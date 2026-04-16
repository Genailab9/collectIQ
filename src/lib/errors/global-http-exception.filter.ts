import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { mapControllerError } from './error-mapper';

/**
 * Ensures every HTTP error is mapped to a stable JSON contract (no ad-hoc Nest defaults).
 */
@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (typeof res.status !== 'function') {
      this.logger.warn('Non-HTTP context in GlobalHttpExceptionFilter');
      return;
    }

    const cid = this.extractCorrelationId(req);
    const mapped = mapControllerError(exception, { correlationId: cid });
    const status = mapped.getStatus();
    const body = mapped.getResponse();

    if (!(exception instanceof HttpException) || status >= 500) {
      this.logger.warn(
        `HTTP ${status} ${req.method} ${req.path} ${exception instanceof Error ? exception.name : 'unknown'}`,
      );
    }

    res.status(status).json(body);
  }

  private extractCorrelationId(req: Request): string | undefined {
    const h = req.headers['x-correlation-id'];
    if (typeof h === 'string' && h.trim()) {
      return h.trim();
    }
    const p = req.params?.correlationId;
    if (typeof p === 'string' && p.trim()) {
      return p.trim();
    }
    const body = req.body as { correlationId?: unknown } | undefined;
    if (body && typeof body.correlationId === 'string' && body.correlationId.trim()) {
      return body.correlationId.trim();
    }
    return undefined;
  }
}
