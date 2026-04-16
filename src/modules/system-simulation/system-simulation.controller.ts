import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { ExecutionFeatureFlagsService } from '../tenant-feature-flags/execution-feature-flags.service';
import { TenantFeatureFlagService } from '../tenant-feature-flags/tenant-feature-flag.service';
import { SystemSimulationDto } from './system-simulation.dto';

@Controller('api/v1/system')
export class SystemSimulationController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly flags: TenantFeatureFlagService,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  @Post('simulation')
  @HttpCode(200)
  async setSimulation(@Body() body: SystemSimulationDto) {
    const tenantId = this.tenantContext.getRequired();
    const out: Record<string, boolean> = {};
    if (body.simulatePaymentFailure !== undefined) {
      await this.flags.upsert(tenantId, 'SIMULATE_PAYMENT_FAILURE', body.simulatePaymentFailure);
      out.SIMULATE_PAYMENT_FAILURE = body.simulatePaymentFailure;
    }
    if (body.simulateApprovalTimeout !== undefined) {
      await this.flags.upsert(tenantId, 'SIMULATE_APPROVAL_TIMEOUT', body.simulateApprovalTimeout);
      out.SIMULATE_APPROVAL_TIMEOUT = body.simulateApprovalTimeout;
    }
    if (body.simulateCallFailure !== undefined) {
      await this.flags.upsert(tenantId, 'SIMULATE_CALL_FAILURE', body.simulateCallFailure);
      out.SIMULATE_CALL_FAILURE = body.simulateCallFailure;
    }
    this.executionFlags.invalidateTenant(tenantId);
    return { ok: true as const, flags: out };
  }
}
