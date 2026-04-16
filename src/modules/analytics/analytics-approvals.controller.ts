import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { TransitionReadModelService } from '../read-model/transition-read-model.service';

@Controller('api/v1/analytics')
export class AnalyticsApprovalsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  @Get('approvals')
  async approvals() {
    return this.readModel.approvalSlaMetrics(this.tenantContext.getRequired());
  }
}
