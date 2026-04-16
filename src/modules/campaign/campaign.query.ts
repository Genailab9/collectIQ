import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignEntity } from './campaign.entity';

@Injectable()
export class CampaignQueryService {
  constructor(
    @InjectRepository(CampaignEntity)
    private readonly campaigns: Repository<CampaignEntity>,
  ) {}

  create(input: Partial<CampaignEntity>): CampaignEntity {
    return this.campaigns.create(input);
  }

  save(row: CampaignEntity): Promise<CampaignEntity> {
    return this.campaigns.save(row);
  }

  listByTenant(tenantId: string): Promise<CampaignEntity[]> {
    return this.campaigns.find({
      where: { tenantId },
      order: { updatedAt: 'DESC' },
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<CampaignEntity | null> {
    return this.campaigns.findOne({
      where: { id, tenantId },
    });
  }

  findActiveByIdForTenant(tenantId: string, id: string): Promise<CampaignEntity | null> {
    return this.campaigns.findOne({
      where: { id, tenantId, status: 'ACTIVE' },
    });
  }
}
