import { ForbiddenException } from '@nestjs/common';
import { TenantFeatureFlagController } from './tenant-feature-flag.controller';

describe('TenantFeatureFlagController policy integration', () => {
  const flags = {
    list: jest.fn(),
    upsert: jest.fn(async (tenantId: string, key: string, value: unknown) => ({
      tenantId,
      key,
      valueJson: JSON.stringify(value),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
  };
  const tenantContext = { getRequired: jest.fn(() => 'tenant-a') };
  const metrics = {
    observeApiLatencyMs: jest.fn(),
    incApiRequestsTotal: jest.fn(),
    incApiErrorsTotal: jest.fn(),
  };
  const structured = { emit: jest.fn() };
  const policyEnforcement = { enforceFeatureFlagUpsert: jest.fn() };

  const controller = new TenantFeatureFlagController(
    flags as never,
    tenantContext as never,
    metrics as never,
    structured as never,
    policyEnforcement as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getRequired.mockReturnValue('tenant-a');
    policyEnforcement.enforceFeatureFlagUpsert.mockReturnValue(undefined);
  });

  it('allows unprotected flag update', async () => {
    const out = await controller.upsert({ key: 'FORCE_PAYMENT_SUCCESS', value: true }, undefined, undefined);
    expect(out.key).toBe('FORCE_PAYMENT_SUCCESS');
    expect(policyEnforcement.enforceFeatureFlagUpsert).toHaveBeenCalledTimes(1);
  });

  it('denies protected flag update without system admin', async () => {
    policyEnforcement.enforceFeatureFlagUpsert.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(controller.upsert({ key: 'ALLOW_TRACE_FULL', value: true } as never, undefined, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('legacy_deprecated mode follows policy for protected flags', async () => {
    policyEnforcement.enforceFeatureFlagUpsert.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(
      controller.upsert({ key: 'ALLOW_TRACE_FULL', value: true } as never, 'admin-key', 'ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
