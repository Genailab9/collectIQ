import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PolicyContextBuilderService } from './policy-context-builder.service';
import { PolicyDecisionAuditService } from './policy-decision-audit.service';
import { PolicyEvaluatorService } from './policy-evaluator.service';
import { PolicyModeService } from './policy-mode.service';

@Injectable()
export class PolicyEnforcementService {
  private readonly logger = new Logger(PolicyEnforcementService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly policyContextBuilder: PolicyContextBuilderService,
    private readonly policyAudit: PolicyDecisionAuditService,
    private readonly policies: PolicyEvaluatorService,
    private readonly policyMode: PolicyModeService,
  ) {}

  enforceAdminOperation(params: {
    tenantId?: string;
    correlationId: string;
    operationType: 'READ' | 'WRITE' | 'EXECUTE';
    resourceType: 'TENANT' | 'SYSTEM';
    riskTier: 'MEDIUM' | 'HIGH';
    adminKeyHeader?: string;
    adminRoleHeader?: string;
  }): void {
    const expectedAdminKey = this.config.get<string>('COLLECTIQ_ADMIN_API_KEY')?.trim() ?? '';
    const policyContext = this.policyContextBuilder.buildAdminOperationContext({
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      operationType: params.operationType,
      resourceType: params.resourceType,
      executionSurface: 'API',
      riskTier: params.riskTier,
      originClass: 'ADMIN_CLIENT',
      adminKeyHeader: params.adminKeyHeader,
      adminRoleHeader: params.adminRoleHeader,
      expectedAdminApiKey: expectedAdminKey,
    });
    const policy = this.policies.evaluate(policyContext);
    const policyAllowed = policy.decision === 'ALLOW';
    const legacyAllowed = true;
    const evaluatorMode = this.policyMode.getMode();
    const effectiveAllowed = policyAllowed;
    if (evaluatorMode === 'shadow' && legacyAllowed !== policyAllowed) {
      this.logger.warn(
        `policy_shadow_mismatch surface=admin_operation correlationId=${params.correlationId} legacy=ALLOW policy=${policyAllowed ? 'ALLOW' : 'DENY'} reason=${policy.reason}`,
      );
    }
    this.policyAudit.record({
      context: policyContext,
      decision: policy,
      evaluatorMode,
      legacyAllowed,
      effectiveAllowed,
    });
    if (!effectiveAllowed) {
      throw new ForbiddenException({
        code: 'ADMIN_POLICY_DENIED',
        policyVersion: policy.policyVersion,
        policyContractVersion: policy.policyContractVersion,
        message: 'Admin action denied by policy evaluation.',
      });
    }
  }

  enforceFeatureFlagUpsert(params: {
    tenantId: string;
    key: string;
    protectedFlag: boolean;
    adminKeyHeader?: string;
    adminRoleHeader?: string;
  }): void {
    const expectedAdminKey = this.config.get<string>('COLLECTIQ_ADMIN_API_KEY')?.trim() ?? '';
    const policyContext = this.policyContextBuilder.buildFeatureFlagUpsertContext({
      tenantId: params.tenantId,
      flagKey: params.key,
      adminKeyHeader: params.adminKeyHeader,
      adminRoleHeader: params.adminRoleHeader,
      expectedAdminApiKey: expectedAdminKey,
      protectedFlag: params.protectedFlag,
    });
    const policy = this.policies.evaluate(policyContext);
    const policyAllowed = policy.decision === 'ALLOW';
    const legacyAllowed = !params.protectedFlag || policyContext.actor.isPrivilegedIdentity === true;
    const evaluatorMode = this.policyMode.getMode();
    const effectiveAllowed = policyAllowed;
    if (evaluatorMode === 'shadow' && legacyAllowed !== policyAllowed) {
      this.logger.warn(
        `policy_shadow_mismatch surface=feature_flag_upsert tenantId=${params.tenantId} key=${params.key} legacy=${legacyAllowed ? 'ALLOW' : 'DENY'} policy=${policyAllowed ? 'ALLOW' : 'DENY'} reason=${policy.reason}`,
      );
    }
    this.policyAudit.record({
      context: policyContext,
      decision: policy,
      evaluatorMode,
      legacyAllowed,
      effectiveAllowed,
    });
    if (!effectiveAllowed) {
      throw new ForbiddenException({
        code: 'FLAG_PROTECTED',
        policyVersion: policy.policyVersion,
        policyContractVersion: policy.policyContractVersion,
        message: `Feature flag "${params.key}" is system-managed and requires ADMIN role.`,
      });
    }
  }

  enforceTenantOperation(params: {
    tenantId: string;
    correlationId: string;
    operationType: 'READ' | 'WRITE';
    riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  }): void {
    const policyContext = this.policyContextBuilder.buildTenantOperationContext({
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      operationType: params.operationType,
      resourceType: 'TENANT',
      executionSurface: 'API',
      riskTier: params.riskTier,
      actorRole: 'TENANT',
    });
    const policy = this.policies.evaluate(policyContext);
    const policyAllowed = policy.decision === 'ALLOW';
    const legacyAllowed = true;
    const evaluatorMode = this.policyMode.getMode();
    const effectiveAllowed = policyAllowed;
    if (evaluatorMode === 'shadow' && legacyAllowed !== policyAllowed) {
      this.logger.warn(
        `policy_shadow_mismatch surface=tenant_operation tenantId=${params.tenantId} correlationId=${params.correlationId} legacy=ALLOW policy=${policyAllowed ? 'ALLOW' : 'DENY'} reason=${policy.reason}`,
      );
    }
    this.policyAudit.record({
      context: policyContext,
      decision: policy,
      evaluatorMode,
      legacyAllowed,
      effectiveAllowed,
    });
    if (!effectiveAllowed) {
      throw new ForbiddenException({
        code: 'TENANT_POLICY_DENIED',
        policyVersion: policy.policyVersion,
        policyContractVersion: policy.policyContractVersion,
        message: 'Tenant action denied by policy evaluation.',
      });
    }
  }
}
