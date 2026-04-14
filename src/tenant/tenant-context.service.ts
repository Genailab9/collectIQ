import { ForbiddenException, Injectable } from '@nestjs/common';
import { tenantAls, type TenantAlsStore } from './tenant-als';

/**
 * PRD v1.2 §5.2 — injectable view of the active tenant from `TenantMiddleware` or `run()`.
 */
@Injectable()
export class TenantContextService {
  getOptional(): string | undefined {
    return tenantAls.getStore()?.tenantId;
  }

  getRequired(): string {
    const t = this.getOptional();
    if (!t) {
      throw new ForbiddenException('Missing tenant context (X-CollectIQ-Tenant-Id or resolved webhook tenant).');
    }
    return t;
  }

  /**
   * Wraps cron / batch work so SMEK and guards see the same tenant as HTTP requests.
   */
  run<T>(tenantId: string, fn: () => T): T;
  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  run<T>(tenantId: string, fn: () => T | Promise<T>): T | Promise<T> {
    const store: TenantAlsStore = { tenantId: tenantId.trim() };
    return tenantAls.run(store, fn);
  }
}
