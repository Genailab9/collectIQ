import { ForbiddenException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { tenantAls } from './tenant-als';

const HEADER = 'x-collectiq-tenant-id';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.path ?? '';

    /** Webhooks: tenant is resolved only after signature verification inside the webhook handler (PRD v1.2 §3–§5). */
    if (path.startsWith('/webhooks/')) {
      next();
      return;
    }

    /** Prometheus metrics scrape (no tenant context). */
    if (path === '/metrics') {
      next();
      return;
    }

    /** Infra probes — no tenant context (liveness/readiness). */
    if (path === '/health' || path.startsWith('/health/') || path === '/live' || path === '/ready') {
      next();
      return;
    }

    /** System-level production gates are global (not tenant-scoped). */
    if (path.startsWith('/system/')) {
      next();
      return;
    }

    /** SaaS admin plane (API key is `X-CollectIQ-Admin-Key`, not tenant-scoped). */
    if (path.startsWith('/saas/admin')) {
      next();
      return;
    }

    /** Stripe billing webhooks (tenant is carried in subscription metadata). */
    if (path === '/saas/billing/webhook') {
      next();
      return;
    }

    const fromHeader = String(req.header(HEADER) ?? '').trim();
    if (!fromHeader) {
      next(new ForbiddenException(`Missing ${HEADER} header.`));
      return;
    }

    tenantAls.run({ tenantId: fromHeader }, () => next());
  }
}
