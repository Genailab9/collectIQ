import { ForbiddenException } from '@nestjs/common';
import { PolicyEnforcementService } from './policy-enforcement.service';

describe('PolicyEnforcementService', () => {
  const config = { get: jest.fn(() => 'admin-key') };
  const policyContextBuilder = {
    buildAdminOperationContext: jest.fn(() => ({ correlationId: 'x' })),
    buildFeatureFlagUpsertContext: jest.fn(() => ({
      tenantId: 't1',
      actor: { isPrivilegedIdentity: false },
      flags: { protectedFlag: true },
    })),
    buildTenantOperationContext: jest.fn(() => ({ tenantId: 't1' })),
  };
  const policyAudit = { record: jest.fn() };
  const policies = { evaluate: jest.fn() };
  const policyMode = { getMode: jest.fn(() => 'shadow') };

  const svc = new PolicyEnforcementService(
    config as never,
    policyContextBuilder as never,
    policyAudit as never,
    policies as never,
    policyMode as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denies admin operation when policy denies (even in shadow mode)', () => {
    policyMode.getMode.mockReturnValue('shadow');
    policies.evaluate.mockReturnValue({
      decision: 'DENY',
      reason: 'unit-deny',
      policyVersion: 'pv',
      policyContractVersion: 1,
    });
    expect(() =>
      svc.enforceAdminOperation({
        correlationId: 'op-1',
        operationType: 'READ',
        resourceType: 'SYSTEM',
        riskTier: 'MEDIUM',
      }),
    ).toThrow(ForbiddenException);
    expect(policyAudit.record).toHaveBeenCalled();
  });

  it('denies feature flag upsert when policy denies', () => {
    policies.evaluate.mockReturnValue({
      decision: 'DENY',
      reason: 'deny-flag',
      policyVersion: 'pv',
      policyContractVersion: 1,
    });
    expect(() =>
      svc.enforceFeatureFlagUpsert({
        tenantId: 't1',
        key: 'ALLOW_TRACE_FULL',
        protectedFlag: true,
      }),
    ).toThrow(ForbiddenException);
  });

  it('denies tenant operation when policy denies', () => {
    policies.evaluate.mockReturnValue({
      decision: 'DENY',
      reason: 'deny-tenant',
      policyVersion: 'pv',
      policyContractVersion: 1,
    });
    expect(() =>
      svc.enforceTenantOperation({
        tenantId: 't1',
        correlationId: 'c1',
        operationType: 'READ',
        riskTier: 'LOW',
      }),
    ).toThrow(ForbiddenException);
  });

  it('allows when policy allows', () => {
    policies.evaluate.mockReturnValue({
      decision: 'ALLOW',
      reason: 'ok',
      policyVersion: 'pv',
      policyContractVersion: 1,
    });
    expect(() =>
      svc.enforceTenantOperation({
        tenantId: 't1',
        correlationId: 'c1',
        operationType: 'READ',
        riskTier: 'LOW',
      }),
    ).not.toThrow();
  });
});
