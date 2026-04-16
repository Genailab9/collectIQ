import type { Repository } from 'typeorm';
import { TenantSaaSProfileEntity } from './entities/tenant-saas-profile.entity';
import { SaaSTenantService } from './saas-tenant.service';
import { SaaSUsageService } from './saas-usage.service';

describe('SaaSUsageService (usage counter matrix)', () => {
  let increment: jest.Mock;
  let profiles: Repository<TenantSaaSProfileEntity>;
  let tenants: SaaSTenantService;
  let service: SaaSUsageService;

  beforeEach(() => {
    increment = jest.fn().mockResolvedValue(undefined);
    profiles = { increment } as unknown as Repository<TenantSaaSProfileEntity>;
    tenants = {
      getOrCreate: jest.fn(async (id: string) => ({
        tenantId: id.trim(),
        displayName: id,
        plan: 'free' as const,
        enabled: true,
        caseCount: 0,
        apiCallCount: 0,
        paymentProcessedCount: 0,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        updatedAt: new Date(),
      })),
    } as unknown as SaaSTenantService;
    service = new SaaSUsageService(profiles, tenants);
  });

  it('incrementApiCalls ensures tenant then increments apiCallCount', async () => {
    await service.incrementApiCalls('tenant-a', 2);
    expect(tenants.getOrCreate).toHaveBeenCalledWith('tenant-a');
    expect(increment).toHaveBeenCalledWith({ tenantId: 'tenant-a' }, 'apiCallCount', 2);
  });

  it('incrementCases increments caseCount', async () => {
    await service.incrementCases('tenant-b', 3);
    expect(increment).toHaveBeenCalledWith({ tenantId: 'tenant-b' }, 'caseCount', 3);
  });

  it('incrementPaymentsProcessed defaults delta to 1', async () => {
    await service.incrementPaymentsProcessed('tenant-c');
    expect(increment).toHaveBeenCalledWith({ tenantId: 'tenant-c' }, 'paymentProcessedCount', 1);
  });

  it('trims tenant id for increment scope', async () => {
    await service.incrementApiCalls('  spaced  ', 1);
    expect(increment).toHaveBeenCalledWith({ tenantId: 'spaced' }, 'apiCallCount', 1);
  });
});
