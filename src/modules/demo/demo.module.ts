import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignModule } from '../campaign/campaign.module';
import { DataIngestionModule } from '../ingestion/data-ingestion.module';
import { ApprovalModule } from '../approval/approval.module';
import { PaymentModule } from '../payment/payment.module';
import { SettlementExecutionModule } from '../settlement-execution/settlement-execution.module';
import { TenantFeatureFlagModule } from '../tenant-feature-flags/tenant-feature-flag.module';
import { TenantFeatureFlagEntity } from '../tenant-feature-flags/tenant-feature-flag.entity';
import { TelephonyWebhookModule } from '../../adapters/telephony/webhooks/telephony-webhook.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantFeatureFlagEntity]),
    TenantFeatureFlagModule,
    CampaignModule,
    DataIngestionModule,
    TelephonyWebhookModule,
    SettlementExecutionModule,
    ApprovalModule,
    PaymentModule,
  ],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
