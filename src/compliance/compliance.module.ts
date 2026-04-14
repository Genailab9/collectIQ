import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantFeatureFlagModule } from '../modules/tenant-feature-flags/tenant-feature-flag.module';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { CompliancePolicySeedService } from './compliance-policy-seed.service';
import { ComplianceService } from './compliance.service';
import { TenantCompliancePolicyEntity } from './entities/tenant-compliance-policy.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantCompliancePolicyEntity, StateTransitionLogEntity]),
    TenantFeatureFlagModule,
  ],
  providers: [ComplianceService, CompliancePolicySeedService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
