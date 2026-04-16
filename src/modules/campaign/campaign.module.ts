import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelModule } from '../../kernel/kernel.module';
import { CampaignEntity } from './campaign.entity';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CampaignQueryService } from './campaign.query';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignEntity]), KernelModule],
  controllers: [CampaignController],
  providers: [CampaignQueryService, CampaignService],
  exports: [CampaignService, TypeOrmModule],
})
export class CampaignModule {}
