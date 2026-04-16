import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { TenantSaaSProfileEntity } from './entities/tenant-saas-profile.entity';
import { SaaSTenantService } from './saas-tenant.service';

function profile(partial: Partial<TenantSaaSProfileEntity>): TenantSaaSProfileEntity {
  return {
    tenantId: 't1',
    displayName: 't1',
    plan: 'free',
    enabled: true,
    caseCount: 0,
    apiCallCount: 0,
    paymentProcessedCount: 0,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    updatedAt: new Date(),
    ...partial,
  } as TenantSaaSProfileEntity;
}

describe('SaaSTenantService (reliability + monetization matrix)', () => {
  let profiles: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: SaaSTenantService;

  beforeEach(() => {
    profiles = {
      findOne: jest.fn(),
      create: jest.fn((row: TenantSaaSProfileEntity) => row),
      save: jest.fn(async (row: TenantSaaSProfileEntity) => row),
    };
    service = new SaaSTenantService(profiles as unknown as Repository<TenantSaaSProfileEntity>);
  });

  describe('getOrCreate', () => {
    it('creates a free profile with zero usage counters when missing', async () => {
      profiles.findOne.mockResolvedValueOnce(null);
      const created = profile({
        tenantId: 'new-tenant',
        displayName: 'new-tenant',
        plan: 'free',
        caseCount: 0,
        apiCallCount: 0,
        paymentProcessedCount: 0,
      });
      profiles.create.mockReturnValueOnce(created);

      const out = await service.getOrCreate('new-tenant');

      expect(out.tenantId).toBe('new-tenant');
      expect(out.plan).toBe('free');
      expect(out.caseCount).toBe(0);
      expect(out.apiCallCount).toBe(0);
      expect(out.paymentProcessedCount).toBe(0);
      expect(profiles.save).toHaveBeenCalledTimes(1);
    });

    it('returns existing row without save when profile exists', async () => {
      const existing = profile({ tenantId: 't1', plan: 'pro', caseCount: 5 });
      profiles.findOne.mockResolvedValueOnce(existing);

      const out = await service.getOrCreate('t1');

      expect(out).toBe(existing);
      expect(profiles.save).not.toHaveBeenCalled();
    });

    it('trims tenant id for lookup and create', async () => {
      profiles.findOne.mockResolvedValueOnce(null);
      profiles.create.mockImplementation((row: TenantSaaSProfileEntity) => row);
      profiles.save.mockImplementation(async (row: TenantSaaSProfileEntity) => row);

      await service.getOrCreate('  spaced-tenant  ');

      expect(profiles.findOne).toHaveBeenCalledWith({ where: { tenantId: 'spaced-tenant' } });
      expect(profiles.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'spaced-tenant' }),
      );
    });
  });

  describe('attachStripeSubscription', () => {
    it('persists Stripe ids and upgrades plan', async () => {
      const row = profile({ tenantId: 't1', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null });
      profiles.findOne.mockResolvedValueOnce(row);
      profiles.save.mockImplementation(async (r: TenantSaaSProfileEntity) => r);

      await service.attachStripeSubscription({
        tenantId: 't1',
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_y',
        plan: 'enterprise',
      });

      expect(row.stripeCustomerId).toBe('cus_x');
      expect(row.stripeSubscriptionId).toBe('sub_y');
      expect(row.plan).toBe('enterprise');
      expect(profiles.save).toHaveBeenCalledWith(row);
    });
  });

  describe('setEnabled / setPlan', () => {
    it('setEnabled toggles and saves', async () => {
      const row = profile({ tenantId: 't1', enabled: true });
      profiles.findOne.mockResolvedValueOnce(row);
      const out = await service.setEnabled('t1', false);
      expect(out.enabled).toBe(false);
      expect(profiles.save).toHaveBeenCalledWith(row);
    });

    it('setPlan updates plan tier', async () => {
      const row = profile({ tenantId: 't1', plan: 'free' });
      profiles.findOne.mockResolvedValueOnce(row);
      const out = await service.setPlan('t1', 'pro');
      expect(out.plan).toBe('pro');
    });
  });

  describe('assertTenantEnabled', () => {
    it('throws NotFoundException when tenant disabled', async () => {
      const row = profile({ tenantId: 't1', enabled: false });
      profiles.findOne.mockResolvedValueOnce(row);
      await expect(service.assertTenantEnabled('t1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves when tenant enabled', async () => {
      profiles.findOne.mockResolvedValueOnce(profile({ tenantId: 't1', enabled: true }));
      await expect(service.assertTenantEnabled('t1')).resolves.toBeUndefined();
    });
  });
});
