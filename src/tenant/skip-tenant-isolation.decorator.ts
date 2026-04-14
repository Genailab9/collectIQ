import { SetMetadata } from '@nestjs/common';

/** Opt out of {@link TenantIsolationGuard} for specific handlers (use sparingly). */
export const SKIP_TENANT_ISOLATION = 'skipTenantIsolation';

export const SkipTenantIsolation = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(SKIP_TENANT_ISOLATION, true);
