import { ForbiddenException } from '@nestjs/common';
import { TenantQueryScopeService } from './tenant-query-scope.service';
import { tenantAls } from './tenant-als';

describe('TenantQueryScopeService', () => {
  it('allows cross-tenant scope when no active tenant context', async () => {
    const svc = new TenantQueryScopeService();
    const out = await svc.withCrossTenantScope(
      {
        reason: 'admin.system',
        operationLabel: 'test_admin',
        contextMarker: 'admin_query_engine',
      },
      async () => 'ok',
    );
    expect(out).toBe('ok');
  });

  it('allows cross-tenant scope from system context', async () => {
    const svc = new TenantQueryScopeService();
    const out = await tenantAls.run({ tenantId: 'system:worker' }, async () =>
      svc.withCrossTenantScope(
        {
          reason: 'tenant.correlation.resolve',
          operationLabel: 'resolve_tenant_for_correlation',
          contextMarker: 'tenant_resolution',
        },
        async () => 'ok',
      ),
    );
    expect(out).toBe('ok');
  });

  it('denies cross-tenant scope from tenant context', async () => {
    const svc = new TenantQueryScopeService();
    await expect(
      tenantAls.run({ tenantId: 'tenant-a' }, async () =>
        svc.withCrossTenantScope(
          {
            reason: 'tenant.correlation.resolve',
            operationLabel: 'resolve_tenant_for_correlation',
            contextMarker: 'tenant_resolution',
          },
          async () => 'nope',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies missing operation label', async () => {
    const svc = new TenantQueryScopeService();
    await expect(
      svc.withCrossTenantScope(
        {
          reason: 'admin.system',
          operationLabel: '',
          contextMarker: 'system_query_engine',
        },
        async () => 'nope',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
