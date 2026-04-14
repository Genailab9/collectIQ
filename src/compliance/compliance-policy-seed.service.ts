/**
 * Inserts **tenant configuration** rows when the DB is empty. This is not SMEK business state;
 * settlement execution still requires `tenant_compliance_policy` to exist for `ComplianceService` gates.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantCompliancePolicyEntity } from './entities/tenant-compliance-policy.entity';

@Injectable()
export class CompliancePolicySeedService implements OnModuleInit {
  private readonly logger = new Logger(CompliancePolicySeedService.name);

  constructor(
    @InjectRepository(TenantCompliancePolicyEntity)
    private readonly policies: Repository<TenantCompliancePolicyEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((await this.policies.count()) === 0) {
      await this.policies.save({
        tenantId: 'default',
        callWindowStartHourLocal: 9,
        callWindowEndHourLocal: 20,
        maxCallAttemptsFromInitiated: 7,
        enabled: true,
      });
      this.logger.warn('Seeded default tenant_compliance_policy for tenantId=default.');
    }
  }
}
