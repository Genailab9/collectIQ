import { Controller, Get } from '@nestjs/common';
import { FeatureFlagService } from '../feature-flags/feature-flag.service';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SaaSTenantService } from './saas-tenant.service';

@Controller('saas/tenant')
export class SaaSTenantController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenants: SaaSTenantService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly policyEnforcement: PolicyEnforcementService,
    private readonly metrics: PrometheusMetricsService,
  ) {}

  @Get('feature-flags')
  getFeatureFlags() {
    this.metrics.incApiRequestsTotal('saas_tenant', 'feature_flags');
    const started = Date.now();
    const tenantId = this.tenantContext.getRequired();
    try {
      this.policyEnforcement.enforceTenantOperation({
        tenantId,
        correlationId: 'tenant-feature-flags',
        operationType: 'READ',
        riskTier: 'LOW',
      });
      return this.featureFlagService.getKnownFlagsSnapshot();
    } catch (error) {
      this.metrics.incApiErrorsTotal('saas_tenant', 'feature_flags', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('saas_tenant', 'feature_flags', Date.now() - started);
    }
  }

  @Get('me')
  async me() {
    this.metrics.incApiRequestsTotal('saas_tenant', 'me');
    const started = Date.now();
    const tenantId = this.tenantContext.getRequired();
    try {
      this.policyEnforcement.enforceTenantOperation({
        tenantId,
        correlationId: 'tenant-profile',
        operationType: 'READ',
        riskTier: 'LOW',
      });
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
    } catch (error) {
      this.metrics.incApiErrorsTotal('saas_tenant', 'me', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('saas_tenant', 'me', Date.now() - started);
    }
  }

}
