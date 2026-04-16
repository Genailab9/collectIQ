import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SKIP_TENANT_ISOLATION } from './skip-tenant-isolation.decorator';
import { TenantContextService } from './tenant-context.service';

/**
 * PRD §15 — rejects requests that have no tenant ALS context (except webhooks/metrics/system and OPTIONS).
 * API routes still require `X-CollectIQ-Tenant-Id` via {@link TenantMiddleware}; this guard is a second line of defense.
 */
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_ISOLATION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request | undefined>();
    if (!req) {
      return true;
    }

    if (req.method === 'OPTIONS') {
      return true;
    }

    const path = req.path ?? '';
    if (
      path.startsWith('/webhooks/') ||
      path === '/metrics' ||
      path === '/health' ||
      path.startsWith('/health/') ||
      path === '/live' ||
      path === '/ready' ||
      path.startsWith('/system/')
    ) {
      return true;
    }

    const tenant = this.tenantContext.getOptional();
    if (!tenant?.trim()) {
      throw new ForbiddenException('PRD §15: missing tenant context (X-CollectIQ-Tenant-Id).');
    }
    return true;
  }
}
