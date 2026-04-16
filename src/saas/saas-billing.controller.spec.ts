import { ForbiddenException } from '@nestjs/common';
import { SaaSBillingController } from './saas-billing.controller';

describe('SaaSBillingController policy integration', () => {
  const config = { get: jest.fn() };
  const tenantContext = { getRequired: jest.fn(() => 'tenant-a') };
  const tenants = {
    getOrCreate: jest.fn(async () => ({
      plan: 'pro',
      caseCount: 1,
      apiCallCount: 2,
      paymentProcessedCount: 3,
    })),
  };
  const adminAudit = { record: jest.fn(async () => undefined) };
  const structured = { emit: jest.fn() };
  const policyEnforcement = { enforceTenantOperation: jest.fn() };
  const metrics = {
    incApiRequestsTotal: jest.fn(),
    observeApiLatencyMs: jest.fn(),
    incApiErrorsTotal: jest.fn(),
  };

  const controller = new SaaSBillingController(
    config as never,
    tenantContext as never,
    tenants as never,
    adminAudit as never,
    structured as never,
    policyEnforcement as never,
    metrics as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getRequired.mockReturnValue('tenant-a');
    policyEnforcement.enforceTenantOperation.mockReturnValue(undefined);
  });

  it('returns billing summary when policy allows', async () => {
    const out = await controller.summary();
    expect(out.plan).toBe('pro');
    expect(policyEnforcement.enforceTenantOperation).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      correlationId: 'billing-summary',
      operationType: 'READ',
      riskTier: 'LOW',
    });
  });

  it('denies billing summary when policy rejects request', async () => {
    policyEnforcement.enforceTenantOperation.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(controller.summary()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
