import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GENERATED_POLICY_CONTRACT } from './generated-policy-contract';
import type { PolicyRequestContext } from './policy-context';

export type PolicyDecision = 'ALLOW' | 'DENY' | 'ELEVATE';

export type PolicyDecisionResult = {
  decision: PolicyDecision;
  reason: string;
  policyVersion: string;
  policyContractVersion: number;
};

export type FullTracePolicyInput = {
  debugEnabled: boolean;
  hasPrivilegedIdentity: boolean;
  killSwitchDisabled: boolean;
  tenantFlagEnabled: boolean;
};

@Injectable()
export class PolicyEvaluatorService implements OnModuleInit {
  private static readonly VERSION = GENERATED_POLICY_CONTRACT.policyVersion;
  private static readonly CONTRACT_VERSION = GENERATED_POLICY_CONTRACT.version;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const configuredVersion = this.config.get<string>('COLLECTIQ_POLICY_CONTRACT_VERSION')?.trim();
    if (configuredVersion && configuredVersion !== String(PolicyEvaluatorService.CONTRACT_VERSION)) {
      throw new Error(
        `POLICY_VERSION_MISMATCH configured=${configuredVersion} compiled=${PolicyEvaluatorService.CONTRACT_VERSION}`,
      );
    }
  }

  /**
   * Side-effect free policy evaluation for observability full trace.
   * This service must not call DB, mutate state, or emit events.
   */
  evaluateFullTrace(input: FullTracePolicyInput): PolicyDecisionResult {
    const traceContract = GENERATED_POLICY_CONTRACT.routes.observability.fullTrace.access;
    if (traceContract.requireDebugHeader && !input.debugEnabled) {
      return this.deny('TRACE_FULL_REQUIRES_DEBUG_HEADER');
    }
    if (!input.hasPrivilegedIdentity) {
      return this.deny('TRACE_FULL_REQUIRES_PRIVILEGED_IDENTITY');
    }
    if (!input.killSwitchDisabled) {
      return this.deny('TRACE_FULL_DISABLED_BY_KILL_SWITCH');
    }
    if (!input.tenantFlagEnabled) {
      return this.deny('TRACE_FULL_FLAG_DISABLED_FOR_TENANT');
    }
    return this.allow('TRACE_FULL_ALLOWED');
  }

  evaluate(ctx: PolicyRequestContext): PolicyDecisionResult {
    if (
      ctx.resourceType === 'OBSERVABILITY_TRACE' &&
      ctx.operationType === 'READ' &&
      ctx.executionSurface === 'API' &&
      ctx.originClass === 'ADMIN_CLIENT'
    ) {
      return this.evaluateFullTrace({
        debugEnabled: ctx.debugEnabled === true,
        hasPrivilegedIdentity: ctx.actor.isPrivilegedIdentity === true,
        killSwitchDisabled: ctx.killSwitches?.traceFullDisabled !== true,
        tenantFlagEnabled: ctx.flags?.tenantFlagEnabled === true,
      });
    }
    if (ctx.resourceType === 'FEATURE_FLAG' && ctx.operationType === 'WRITE' && ctx.executionSurface === 'API') {
      const isProtectedFlag = ctx.flags?.protectedFlag === true;
      if (!isProtectedFlag) {
        return this.allow('FEATURE_FLAG_UPSERT_ALLOWED_UNPROTECTED');
      }
      if (ctx.actor.isPrivilegedIdentity === true) {
        return this.allow('FEATURE_FLAG_UPSERT_ALLOWED_PROTECTED_SYSTEM_ADMIN');
      }
      return this.deny('FEATURE_FLAG_UPSERT_DENIED_PROTECTED_REQUIRES_SYSTEM_ADMIN');
    }
    if (
      (ctx.resourceType === 'TENANT' || ctx.resourceType === 'SYSTEM') &&
      (ctx.operationType === 'READ' || ctx.operationType === 'WRITE' || ctx.operationType === 'EXECUTE') &&
      ctx.executionSurface === 'API' &&
      ctx.originClass === 'ADMIN_CLIENT'
    ) {
      if (ctx.actor.isPrivilegedIdentity === true) {
        return this.allow(`ADMIN_PLANE_${ctx.resourceType}_${ctx.operationType}_ALLOWED`);
      }
      return this.deny(`ADMIN_PLANE_${ctx.resourceType}_${ctx.operationType}_DENIED_REQUIRES_ADMIN_KEY`);
    }
    if (
      ctx.resourceType === 'TENANT' &&
      (ctx.operationType === 'READ' || ctx.operationType === 'WRITE') &&
      ctx.executionSurface === 'API' &&
      ctx.originClass === 'TENANT_CLIENT'
    ) {
      if (ctx.tenantId.trim() && ctx.tenantId.trim() !== 'admin-plane') {
        return this.allow(`TENANT_PLANE_${ctx.operationType}_ALLOWED`);
      }
      return this.deny(`TENANT_PLANE_${ctx.operationType}_DENIED_INVALID_TENANT_SCOPE`);
    }
    return this.deny('POLICY_CONTEXT_NOT_SUPPORTED');
  }

  private allow(reason: string): PolicyDecisionResult {
    return {
      decision: 'ALLOW',
      reason,
      policyVersion: PolicyEvaluatorService.VERSION,
      policyContractVersion: PolicyEvaluatorService.CONTRACT_VERSION,
    };
  }

  private deny(reason: string): PolicyDecisionResult {
    return {
      decision: 'DENY',
      reason,
      policyVersion: PolicyEvaluatorService.VERSION,
      policyContractVersion: PolicyEvaluatorService.CONTRACT_VERSION,
    };
  }
}
