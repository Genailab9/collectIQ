import { Controller, Get } from '@nestjs/common';
import { FeatureFlagService } from '../feature-flags/feature-flag.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SaaSTenantService } from './saas-tenant.service';

@Controller('saas/tenant')
export class SaaSTenantController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenants: SaaSTenantService,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  @Get('feature-flags')
  getFeatureFlags() {
    return this.featureFlagService.getKnownFlagsSnapshot();
  }

  @Get('me')
  async me() {
    const tenantId = this.tenantContext.getRequired();
    const profile = await this.tenants.getOrCreate(tenantId);
    return {
      tenantId: profile.tenantId,
      displayName: profile.displayName,
      plan: profile.plan,
      enabled: profile.enabled,
      usage: {
        cases: profile.caseCount,
        apiCalls: profile.apiCallCount,
        paymentsProcessed: profile.paymentProcessedCount,
      },
      stripe: {
        customerConfigured: Boolean(profile.stripeCustomerId),
        subscriptionConfigured: Boolean(profile.stripeSubscriptionId),
      },
    };
  }
}
