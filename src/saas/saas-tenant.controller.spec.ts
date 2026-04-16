import { ForbiddenException } from '@nestjs/common';
import { SaaSTenantController } from './saas-tenant.controller';

describe('SaaSTenantController policy integration', () => {
  const tenantContext = { getRequired: jest.fn(() => 'tenant-a') };
  const tenants = {
    getOrCreate: jest.fn(async () => ({
      tenantId: 'tenant-a',
      displayName: 'Tenant A',
      plan: 'pro',
      enabled: true,
      caseCount: 10,
      apiCallCount: 100,
      paymentProcessedCount: 5,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    })),
  };
  const featureFlagService = { getKnownFlagsSnapshot: jest.fn(() => ({ DEMO_MODE: true })) };
  const policyEnforcement = { enforceTenantOperation: jest.fn() };
  const metrics = {
    incApiRequestsTotal: jest.fn(),
    observeApiLatencyMs: jest.fn(),
    incApiErrorsTotal: jest.fn(),
  };

  const controller = new SaaSTenantController(
    tenantContext as never,
    tenants as never,
    featureFlagService as never,
    policyEnforcement as never,
    metrics as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getRequired.mockReturnValue('tenant-a');
    policyEnforcement.enforceTenantOperation.mockReturnValue(undefined);
  });

  it('returns feature flags when policy allows', () => {
    const out = controller.getFeatureFlags();
    expect(out).toEqual({ DEMO_MODE: true });
    expect(policyEnforcement.enforceTenantOperation).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      correlationId: 'tenant-feature-flags',
      operationType: 'READ',
      riskTier: 'LOW',
    });
  });

  it('returns tenant profile when policy allows', async () => {
    const out = await controller.me();
    expect(out.tenantId).toBe('tenant-a');
    expect(out.plan).toBe('pro');
    expect(policyEnforcement.enforceTenantOperation).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      correlationId: 'tenant-profile',
      operationType: 'READ',
      riskTier: 'LOW',
    });
  });

  it('denies me when policy rejects request', async () => {
    policyEnforcement.enforceTenantOperation.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(controller.me()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
