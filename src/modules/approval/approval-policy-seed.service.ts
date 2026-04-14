import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantApprovalPolicyEntity } from './entities/tenant-approval-policy.entity';

/**
 * Inserts **tenant configuration** when the DB is empty. Not SMEK transition state; required so
 * `CollectiqApprovalAdapter` can read policy bands inside SMEK.
 */
@Injectable()
export class ApprovalPolicySeedService implements OnModuleInit {
  private readonly logger = new Logger(ApprovalPolicySeedService.name);

  constructor(
    @InjectRepository(TenantApprovalPolicyEntity)
    private readonly policies: Repository<TenantApprovalPolicyEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.policies.count();
    if (count > 0) {
      return;
    }
    await this.policies.save({
      tenantId: 'default',
      bandLowCents: 0,
      bandHighCents: 50_000_000,
      minOfferCents: 0,
      maxOfferCents: 100_000_000,
      pendingTimeoutSeconds: 3600,
    });
    this.logger.warn('Seeded default tenant approval policy for tenantId=default (replace for production).');
  }
}
