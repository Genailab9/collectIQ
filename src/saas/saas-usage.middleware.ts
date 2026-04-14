import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SaaSUsageService } from './saas-usage.service';

const PREFIXES = [
  '/payments',
  '/approvals',
  '/execution',
  '/ingestion',
  '/observability',
  '/saas/tenant',
] as const;

function shouldCount(path: string): boolean {
  const p = path.split('?')[0] ?? '';
  return PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * PRD SaaS — lightweight per-tenant API usage counter (no PII).
 */
@Injectable()
export class SaaSUsageMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly usage: SaaSUsageService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const path = req.path ?? '';
    if (path.startsWith('/saas/admin') || path === '/saas/billing/webhook') {
      next();
      return;
    }
    if (!shouldCount(path)) {
      next();
      return;
    }
    let tenantId: string | undefined;
    try {
      tenantId = this.tenantContext.getRequired();
    } catch {
      next();
      return;
    }
    try {
      await this.usage.incrementApiCalls(tenantId, 1);
    } catch {
      // Never block requests on usage accounting failures.
    }
    next();
  }
}
