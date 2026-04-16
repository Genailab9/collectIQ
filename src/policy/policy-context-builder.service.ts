import { Injectable } from '@nestjs/common';
import { timingSafeEqualStrings } from '../security/timing-safe-equal';
import type { PolicyRequestContext } from './policy-context';

export type BuildTraceFullPolicyContextInput = {
  tenantId: string;
  correlationId: string;
  debugHeader?: string;
  adminKeyHeader?: string;
  adminActorHeader?: string;
  adminRoleHeader?: string;
  expectedAdminApiKey: string;
  tenantFlagEnabled: boolean;
  traceFullDisabledByKillSwitch: boolean;
};

export type BuildFeatureFlagUpsertPolicyContextInput = {
  tenantId: string;
  flagKey: string;
  adminKeyHeader?: string;
  adminRoleHeader?: string;
  expectedAdminApiKey: string;
  protectedFlag: boolean;
};

export type BuildAdminOperationPolicyContextInput = {
  tenantId?: string;
  correlationId?: string;
  operationType: 'READ' | 'WRITE' | 'EXECUTE' | 'ADMIN';
  resourceType: 'TENANT' | 'SYSTEM';
  executionSurface: 'API';
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  originClass?: 'ADMIN_CLIENT' | 'SYSTEM' | 'UNKNOWN';
  adminKeyHeader?: string;
  adminRoleHeader?: string;
  expectedAdminApiKey: string;
};

export type BuildTenantOperationPolicyContextInput = {
  tenantId: string;
  correlationId?: string;
  operationType: 'READ' | 'WRITE' | 'EXECUTE';
  resourceType: 'TENANT' | 'SYSTEM';
  executionSurface: 'API' | 'WEBHOOK';
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actorId?: string;
  actorRole?: string;
};

@Injectable()
export class PolicyContextBuilderService {
  buildTraceFullContext(input: BuildTraceFullPolicyContextInput): PolicyRequestContext {
    const debugEnabled = String(input.debugHeader ?? '').trim().toLowerCase() === 'true';
    const providedAdminKey = String(input.adminKeyHeader ?? '').trim();
    const privilegedActor = String(input.adminActorHeader ?? '').trim();
    const role = String(input.adminRoleHeader ?? '').trim().toUpperCase();
    const expectedAdminKey = input.expectedAdminApiKey.trim();
    const hasPrivilegedIdentity =
      expectedAdminKey.length > 0 &&
      providedAdminKey.length > 0 &&
      timingSafeEqualStrings(providedAdminKey, expectedAdminKey) &&
      privilegedActor.length > 0 &&
      (role === 'ADMIN' || role === 'SYSTEM');
    return {
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      operationType: 'READ',
      resourceType: 'OBSERVABILITY_TRACE',
      executionSurface: 'API',
      riskTier: 'HIGH',
      originClass: 'ADMIN_CLIENT',
      actor: {
        actorId: privilegedActor || undefined,
        role: role || undefined,
        isPrivilegedIdentity: hasPrivilegedIdentity,
      },
      debugEnabled,
      flags: { tenantFlagEnabled: input.tenantFlagEnabled },
      killSwitches: { traceFullDisabled: input.traceFullDisabledByKillSwitch },
    };
  }

  buildFeatureFlagUpsertContext(input: BuildFeatureFlagUpsertPolicyContextInput): PolicyRequestContext {
    const providedAdminKey = String(input.adminKeyHeader ?? '').trim();
    const role = String(input.adminRoleHeader ?? '').trim().toUpperCase();
    const expectedAdminKey = input.expectedAdminApiKey.trim();
    const hasPrivilegedIdentity =
      expectedAdminKey.length > 0 &&
      providedAdminKey.length > 0 &&
      timingSafeEqualStrings(providedAdminKey, expectedAdminKey) &&
      (role === 'ADMIN' || role === 'SYSTEM');
    const originClass =
      providedAdminKey.length > 0 || role.length > 0
        ? 'ADMIN_CLIENT'
        : ('TENANT_CLIENT' as const);
    return {
      tenantId: input.tenantId,
      correlationId: `feature-flag:${input.flagKey.trim().toUpperCase()}`,
      operationType: 'WRITE',
      resourceType: 'FEATURE_FLAG',
      executionSurface: 'API',
      riskTier: input.protectedFlag ? 'HIGH' : 'MEDIUM',
      originClass,
      actor: {
        role: role || undefined,
        isPrivilegedIdentity: hasPrivilegedIdentity,
      },
      flags: {
        protectedFlag: input.protectedFlag,
      },
    };
  }

  buildAdminOperationContext(input: BuildAdminOperationPolicyContextInput): PolicyRequestContext {
    const providedAdminKey = String(input.adminKeyHeader ?? '').trim();
    const role = String(input.adminRoleHeader ?? '').trim().toUpperCase();
    const expectedAdminKey = input.expectedAdminApiKey.trim();
    const hasPrivilegedIdentity =
      expectedAdminKey.length > 0 &&
      providedAdminKey.length > 0 &&
      timingSafeEqualStrings(providedAdminKey, expectedAdminKey) &&
      (role === 'ADMIN' || role === 'SYSTEM');
    return {
      tenantId: input.tenantId?.trim() || 'admin-plane',
      correlationId: input.correlationId?.trim(),
      operationType: input.operationType,
      resourceType: input.resourceType,
      executionSurface: input.executionSurface,
      riskTier: input.riskTier,
      originClass: input.originClass ?? 'ADMIN_CLIENT',
      actor: {
        role: role || undefined,
        isPrivilegedIdentity: hasPrivilegedIdentity,
      },
    };
  }

  buildTenantOperationContext(input: BuildTenantOperationPolicyContextInput): PolicyRequestContext {
    return {
      tenantId: input.tenantId.trim(),
      correlationId: input.correlationId?.trim(),
      operationType: input.operationType,
      resourceType: input.resourceType,
      executionSurface: input.executionSurface,
      riskTier: input.riskTier,
      originClass: 'TENANT_CLIENT',
      actor: {
        actorId: input.actorId?.trim() || undefined,
        role: input.actorRole?.trim().toUpperCase() || undefined,
        isPrivilegedIdentity: false,
      },
    };
  }
}
