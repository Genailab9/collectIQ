import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SaaSTenantService } from './saas-tenant.service';

const PREFIXES = [
  '/payments',
  '/approvals',
  '/execution',
  '/ingestion',
  '/observability',
  '/saas/tenant',
  '/saas/billing',
  '/saas/audit',
] as const;

function shouldGuard(path: string): boolean {
  const p = path.split('?')[0] ?? '';
  return PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * Blocks execution-plane HTTP when tenant is administratively disabled.
 */
@Injectable()
export class SaaSTenantStatusMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenants: SaaSTenantService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const path = req.path ?? '';
    if (path.startsWith('/saas/admin') || path === '/saas/billing/webhook') {
      next();
      return;
    }
    if (!shouldGuard(path)) {
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
    const profile = await this.tenants.getOrCreate(tenantId);
    if (!profile.enabled) {
      throw new ForbiddenException('Tenant is disabled.');
    }
    next();
  }
}
