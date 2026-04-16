import { ForbiddenException } from '@nestjs/common';
import { SaaSAdminController } from './saas-admin.controller';

describe('SaaSAdminController policy integration', () => {
  const tenants = {
    listAll: jest.fn(),
    setEnabled: jest.fn(async (tenantId: string, enabled: boolean) => ({ tenantId, enabled })),
  };
  const webhookRecovery = {
    recoverMissingWebhooksSince: jest.fn(async () => undefined),
  };
  const config = { get: jest.fn() };
  const featureFlags = { getKnownFlagsSnapshot: jest.fn(() => ({})) };
  const resilience = { getCircuitDiagnostics: jest.fn(() => []) };
  const metrics = {
    renderPrometheusText: jest.fn(() => 'ok'),
    observeApiLatencyMs: jest.fn(),
    incApiRequestsTotal: jest.fn(),
    incApiErrorsTotal: jest.fn(),
  };
  const structured = { emit: jest.fn() };
  const adminAudit = { record: jest.fn(async () => undefined) };
  const survivalJobs = { enqueue: jest.fn(async () => undefined) };
  const policyEnforcement = { enforceAdminOperation: jest.fn() };

  const controller = new SaaSAdminController(
    tenants as never,
    webhookRecovery as never,
    config as never,
    featureFlags as never,
    resilience as never,
    metrics as never,
    structured as never,
    adminAudit as never,
    survivalJobs as never,
    policyEnforcement as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (config.get as jest.Mock).mockImplementation((k: string, d?: string) => {
      if (k === 'COLLECTIQ_ADMIN_API_KEY') return 'admin-key';
      if (k === 'RECOVERY_WORKER_ENABLED') return d ?? 'true';
      if (k === 'WEBHOOK_RECOVERY_ENABLED') return d ?? 'true';
      return d;
    });
    policyEnforcement.enforceAdminOperation.mockReturnValue(undefined);
  });

  it('allows tenant enable update in shadow mode', async () => {
    const out = await controller.setEnabled('tenant-a', { enabled: true }, 'admin-key', 'ADMIN', 'ops-user');
    expect(out).toEqual({ tenantId: 'tenant-a', enabled: true });
    expect(policyEnforcement.enforceAdminOperation).toHaveBeenCalledTimes(1);
  });

  it('denies tenant enable update when enforce mode denies policy', async () => {
    (config.get as jest.Mock).mockImplementation((k: string) => {
      if (k === 'COLLECTIQ_ADMIN_API_KEY') return 'admin-key';
      return undefined;
    });
    policyEnforcement.enforceAdminOperation.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(controller.setEnabled('tenant-a', { enabled: true }, 'admin-key', 'ADMIN', 'ops-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows recovery trigger in shadow mode', async () => {
    const out = await controller.triggerRecovery('admin-key', 'ADMIN', 'ops-user');
    expect(out.ok).toBe(true);
    expect(policyEnforcement.enforceAdminOperation).toHaveBeenCalledTimes(1);
  });

  it('allows list tenants in shadow mode', async () => {
    tenants.listAll.mockResolvedValueOnce([{ tenantId: 'tenant-a' }]);
    const out = await controller.listTenants('admin-key', 'ADMIN');
    expect(out).toEqual([{ tenantId: 'tenant-a' }]);
    expect(policyEnforcement.enforceAdminOperation).toHaveBeenCalledTimes(1);
  });

  it('denies system health read when enforce mode denies policy', async () => {
    (config.get as jest.Mock).mockImplementation((k: string, d?: string) => {
      if (k === 'COLLECTIQ_ADMIN_API_KEY') return 'admin-key';
      if (k === 'RECOVERY_WORKER_ENABLED') return d ?? 'true';
      if (k === 'WEBHOOK_RECOVERY_ENABLED') return d ?? 'true';
      return d;
    });
    policyEnforcement.enforceAdminOperation.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(controller.systemHealth('admin-key', 'ADMIN')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
