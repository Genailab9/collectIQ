import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { TransitionReadModelService } from '../read-model/transition-read-model.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  @Get('metrics')
  async metrics() {
    const tenantId = this.tenantContext.getRequired();
    return this.readModel.dashboardMetrics(tenantId);
  }
}
