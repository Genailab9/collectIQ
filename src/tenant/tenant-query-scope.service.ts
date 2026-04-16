import { ForbiddenException, Injectable } from '@nestjs/common';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { emitRuntimeProof } from '../runtime-proof/runtime-proof-emitter';
import { tenantAls } from './tenant-als';

export type CrossTenantScopeReason =
  | 'admin.system'
  | 'kernel.escalation.scan'
  | 'tenant.correlation.resolve';

export interface CrossTenantScopeOptions {
  readonly reason: CrossTenantScopeReason;
  readonly operationLabel: string;
  readonly contextMarker: 'admin_query_engine' | 'system_query_engine' | 'kernel_recovery' | 'tenant_resolution';
}

const ALLOWED_REASONS = new Set<CrossTenantScopeReason>([
  'admin.system',
  'kernel.escalation.scan',
  'tenant.correlation.resolve',
]);

/**
 * Enforces tenant-aware query entrypoints for read/query services.
 */
@Injectable()
export class TenantQueryScopeService {
  forRepo<Entity extends ObjectLiteral>(
    repository: Repository<Entity>,
    alias: string,
    tenantId: string,
  ): SelectQueryBuilder<Entity> {
    const t = tenantId.trim();
    if (!t) {
      throw new ForbiddenException('Tenant scope is required for query access.');
    }
    return repository.createQueryBuilder(alias).where(`${alias}.tenantId = :tenantId`, { tenantId: t });
  }

  async withCrossTenantScope<T>(options: CrossTenantScopeOptions, operation: () => Promise<T>): Promise<T> {
    const reason = String(options.reason ?? '').trim() as CrossTenantScopeReason;
    const operationLabel = String(options.operationLabel ?? '').trim();
    const contextMarker = String(options.contextMarker ?? '').trim();
    if (!ALLOWED_REASONS.has(reason)) {
      throw new ForbiddenException(`Cross-tenant scope reason is not allowed: "${reason || '<missing>'}".`);
    }
    if (!operationLabel) {
      throw new ForbiddenException('Cross-tenant scope requires a non-empty operation label.');
    }
    if (!contextMarker) {
      throw new ForbiddenException('Cross-tenant scope requires a context marker.');
    }
    const activeTenant = tenantAls.getStore()?.tenantId?.trim();
    if (activeTenant && !activeTenant.startsWith('system:')) {
      emitRuntimeProof({
        requirement_id: 'REQ-TEN-001',
        event_type: 'AUTH_EVENT',
        tenant_id: activeTenant,
        metadata: {
          reason,
          operationLabel,
          contextMarker,
          outcome: 'DENY',
          cause: 'active_tenant_context_present',
        },
      });
      throw new ForbiddenException(
        'Cross-tenant scope is only allowed from system contexts (active tenant context is set).',
      );
    }
    emitRuntimeProof({
      requirement_id: 'REQ-TEN-001',
      event_type: 'AUTH_EVENT',
      tenant_id: activeTenant || 'n/a',
      metadata: { reason, operationLabel, contextMarker, outcome: 'ALLOW', scope: 'cross_tenant' },
    });
    return operation();
  }
}
