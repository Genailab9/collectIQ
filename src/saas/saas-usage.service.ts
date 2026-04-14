import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSaaSProfileEntity } from './entities/tenant-saas-profile.entity';
import { SaaSTenantService } from './saas-tenant.service';

@Injectable()
export class SaaSUsageService {
  constructor(
    @InjectRepository(TenantSaaSProfileEntity)
    private readonly profiles: Repository<TenantSaaSProfileEntity>,
    private readonly tenants: SaaSTenantService,
  ) {}

  async incrementApiCalls(tenantId: string, delta = 1): Promise<void> {
    const id = tenantId.trim();
    await this.tenants.getOrCreate(id);
    await this.profiles.increment({ tenantId: id }, 'apiCallCount', delta);
  }

  async incrementCases(tenantId: string, delta: number): Promise<void> {
    const id = tenantId.trim();
    await this.tenants.getOrCreate(id);
    await this.profiles.increment({ tenantId: id }, 'caseCount', delta);
  }

  async incrementPaymentsProcessed(tenantId: string, delta = 1): Promise<void> {
    const id = tenantId.trim();
    await this.tenants.getOrCreate(id);
    await this.profiles.increment({ tenantId: id }, 'paymentProcessedCount', delta);
  }
}
