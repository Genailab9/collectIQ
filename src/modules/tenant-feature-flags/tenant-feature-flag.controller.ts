import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { UpsertTenantFeatureFlagDto } from './tenant-feature-flag.dto';
import { TenantFeatureFlagService } from './tenant-feature-flag.service';

@Controller('feature-flags')
export class TenantFeatureFlagController {
  constructor(
    private readonly flags: TenantFeatureFlagService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  async list() {
    const tenantId = this.tenantContext.getRequired();
    const rows = (await this.flags.list(tenantId)).filter((r) => !r.key.startsWith('__'));
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.valueJson) as unknown;
      } catch {
        out[r.key] = r.valueJson;
      }
    }
    return { flags: out, rows };
  }

  @Post()
  @HttpCode(200)
  async upsert(@Body() body: UpsertTenantFeatureFlagDto) {
    const tenantId = this.tenantContext.getRequired();
    const row = await this.flags.upsert(tenantId, body.key, body.value);
    return {
      key: row.key,
      value: JSON.parse(row.valueJson) as unknown,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
