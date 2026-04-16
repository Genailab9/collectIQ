import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { emitRuntimeProof } from './runtime-proof-emitter';
import { mapPathToRequirementId } from './requirement-map';

@Injectable()
export class RuntimeProofMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.path ?? '';
    const startedAt = Date.now();
    const tenantId = String(req.header('x-collectiq-tenant-id') ?? 'n/a').trim() || 'n/a';
    const requirementId = mapPathToRequirementId(path);

    res.on('finish', () => {
      emitRuntimeProof({
        requirement_id: requirementId,
        event_type: 'API_HIT',
        tenant_id: tenantId,
        metadata: {
          method: req.method,
          path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
      });
      if (res.statusCode >= 500) {
        emitRuntimeProof({
          requirement_id: requirementId,
          event_type: 'ERROR_STATE',
          tenant_id: tenantId,
          metadata: {
            method: req.method,
            path,
            statusCode: res.statusCode,
          },
        });
      }
    });

    next();
  }
}

