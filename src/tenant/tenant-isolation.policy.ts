import { ForbiddenException } from '@nestjs/common';
import { SmekCommandStructuralError } from '../kernel/smek-kernel.errors';

/**
 * PRD §15 — when an HTTP/cron tenant context is active, SMEK transitions must target the same tenant.
 */
export function assertSmekTransitionTenantMatchesOptionalAls(
  activeTenantId: string | undefined,
  transitionTenantId: string,
): void {
  if (activeTenantId === undefined) {
    return;
  }
  const a = activeTenantId.trim();
  const t = transitionTenantId.trim();
  if (a !== t) {
    throw new SmekCommandStructuralError(
      `SMEK transition tenantId "${transitionTenantId}" does not match active tenant context "${activeTenantId}".`,
    );
  }
}

/**
 * PRD §15 — validates that a TypeORM `find`/`findOne` style `where` object constrains `tenantId`
 * (top-level). Use for defensive checks on sensitive reads.
 */
export function assertFindOptionsIncludesTenantId(where: unknown): void {
  if (where === null || where === undefined) {
    throw new ForbiddenException('PRD §15: tenant-scoped query requires a where clause.');
  }
  if (typeof where !== 'object') {
    throw new ForbiddenException('PRD §15: tenant-scoped query where clause must be an object.');
  }
  const o = where as Record<string, unknown>;
  if ('tenantId' in o && o.tenantId !== undefined && o.tenantId !== null) {
    return;
  }
  throw new ForbiddenException('PRD §15: repository query must include tenantId in where.');
}
