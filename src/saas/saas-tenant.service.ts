import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminPlaneQuery } from './admin-plane-query.decorator';
import { TenantSaaSProfileEntity, type SaaSPlan } from './entities/tenant-saas-profile.entity';

@Injectable()
export class SaaSTenantService {
  constructor(
    @InjectRepository(TenantSaaSProfileEntity)
    private readonly profiles: Repository<TenantSaaSProfileEntity>,
  ) {}

  async getOrCreate(tenantId: string): Promise<TenantSaaSProfileEntity> {
    const id = tenantId.trim();
    let row = await this.profiles.findOne({ where: { tenantId: id } });
    if (!row) {
      row = this.profiles.create({
        tenantId: id,
        displayName: id,
        plan: 'free',
        enabled: true,
        caseCount: 0,
        apiCallCount: 0,
        paymentProcessedCount: 0,
      });
      await this.profiles.save(row);
    }
    return row;
  }

  @AdminPlaneQuery()
  async listAll(): Promise<TenantSaaSProfileEntity[]> {
    return this.profiles.find({ order: { tenantId: 'ASC' } });
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<TenantSaaSProfileEntity> {
    const row = await this.getOrCreate(tenantId);
    row.enabled = enabled;
    return this.profiles.save(row);
  }

  async setPlan(tenantId: string, plan: SaaSPlan): Promise<TenantSaaSProfileEntity> {
    const row = await this.getOrCreate(tenantId);
    row.plan = plan;
    return this.profiles.save(row);
  }

  async assertTenantEnabled(tenantId: string): Promise<void> {
    const row = await this.getOrCreate(tenantId);
    if (!row.enabled) {
      throw new NotFoundException('Tenant is disabled. Contact your administrator.');
    }
  }

  async attachStripeSubscription(params: {
    tenantId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    plan: SaaSPlan;
  }): Promise<void> {
    const row = await this.getOrCreate(params.tenantId);
    row.stripeCustomerId = params.stripeCustomerId;
    row.stripeSubscriptionId = params.stripeSubscriptionId;
    row.plan = params.plan;
    await this.profiles.save(row);
  }
}
