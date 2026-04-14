import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { CreateCampaignDto } from './campaign.dto';
import { CampaignService } from './campaign.service';

@Controller('campaigns')
export class CampaignController {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: CreateCampaignDto) {
    const tenantId = this.tenantContext.getRequired();
    const row = await this.campaigns.create(tenantId, {
      name: body.name,
      description: body.description ?? null,
    });
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  @Get()
  async list() {
    const tenantId = this.tenantContext.getRequired();
    const rows = await this.campaigns.list(tenantId);
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const tenantId = this.tenantContext.getRequired();
    const row = await this.campaigns.getById(tenantId, id);
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
