import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelModule } from '../../kernel/kernel.module';
import { SaaSCoreModule } from '../../saas/saas-core.module';
import { CampaignModule } from '../campaign/campaign.module';
import { DataIngestionController } from './data-ingestion.controller';
import { DataIngestionService } from './data-ingestion.service';
import { DataIngestionRecordEntity } from './entities/data-ingestion-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DataIngestionRecordEntity]), KernelModule, SaaSCoreModule, CampaignModule],
  controllers: [DataIngestionController],
  providers: [DataIngestionService],
  exports: [DataIngestionService],
})
export class DataIngestionModule {}
