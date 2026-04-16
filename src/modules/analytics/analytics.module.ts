import { Module } from '@nestjs/common';
import { ReadModelModule } from '../read-model/read-model.module';
import { TenantModule } from '../../tenant/tenant.module';
import { AnalyticsApprovalsController } from './analytics-approvals.controller';

@Module({
  imports: [ReadModelModule, TenantModule],
  controllers: [AnalyticsApprovalsController],
})
export class AnalyticsModule {}
