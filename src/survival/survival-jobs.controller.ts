import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SurvivalJobsService } from './survival-jobs.service';

@Controller('survival/jobs')
export class SurvivalJobsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly jobs: SurvivalJobsService,
  ) {}

  /** Tenant-scoped job visibility (queue depth is global in DB; recent rows filtered by tenant payloads when set). */
  @Get('summary')
  async summary() {
    const tenantId = this.tenantContext.getRequired();
    return this.jobs.summary(tenantId);
  }
}
