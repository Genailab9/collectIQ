import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CampaignEntity } from './campaign.entity';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(CampaignEntity)
    private readonly campaigns: Repository<CampaignEntity>,
  ) {}

  async create(tenantId: string, input: { name: string; description?: string | null }): Promise<CampaignEntity> {
    const t = tenantId.trim();
    const row = this.campaigns.create({
      id: randomUUID(),
      tenantId: t,
      name: input.name.trim().slice(0, 512),
      description: input.description?.trim() ? input.description.trim().slice(0, 4000) : null,
      status: 'ACTIVE',
    });
    return this.campaigns.save(row);
  }

  async list(tenantId: string): Promise<CampaignEntity[]> {
    return this.campaigns.find({
      where: { tenantId: tenantId.trim() },
      order: { updatedAt: 'DESC' },
    });
  }

  async getById(tenantId: string, id: string): Promise<CampaignEntity> {
    const row = await this.campaigns.findOne({
      where: { id: id.trim(), tenantId: tenantId.trim() },
    });
    if (!row) {
      throw new NotFoundException('Campaign not found.');
    }
    return row;
  }

  async assertActiveForTenant(tenantId: string, campaignId: string): Promise<void> {
    const row = await this.campaigns.findOne({
      where: { id: campaignId.trim(), tenantId: tenantId.trim(), status: 'ACTIVE' },
    });
    if (!row) {
      throw new NotFoundException('Campaign not found or not active for this tenant.');
    }
  }
}
