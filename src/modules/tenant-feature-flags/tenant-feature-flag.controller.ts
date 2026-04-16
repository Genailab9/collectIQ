import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { StructuredLoggerService } from '../../observability/structured-logger.service';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { PolicyEnforcementService } from '../../policy/policy-enforcement.service';
import { emitPlaneEvent } from '../../observability/control-plane-event';
import { GENERATED_POLICY_CONTRACT } from '../../policy/generated-policy-contract';
import { UpsertTenantFeatureFlagDto } from './tenant-feature-flag.dto';
import { TenantFeatureFlagService } from './tenant-feature-flag.service';

const SYSTEM_ONLY_FLAGS = new Set(
  GENERATED_POLICY_CONTRACT.featureFlags.protected.map((x) => x.trim().toUpperCase()),
);

@Controller('feature-flags')
export class TenantFeatureFlagController {
  constructor(
    private readonly flags: TenantFeatureFlagService,
    private readonly tenantContext: TenantContextService,
    private readonly metrics: PrometheusMetricsService,
    private readonly structured: StructuredLoggerService,
    private readonly policyEnforcement: PolicyEnforcementService,
  ) {}

  @Get()
  async list() {
    this.metrics.incApiRequestsTotal('feature_flags', 'list');
    const tenantId = this.tenantContext.getRequired();
    const started = Date.now();
    try {
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
    } catch (error) {
      this.metrics.incApiErrorsTotal('feature_flags', 'list', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('feature_flags', 'list', Date.now() - started);
    }
  }

  @Post()
  @HttpCode(200)
  async upsert(
    @Body() body: UpsertTenantFeatureFlagDto,
    @Headers('x-collectiq-admin-key') adminKeyHeader?: string,
    @Headers('x-collectiq-admin-role') adminRoleHeader?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('feature_flags', 'upsert');
    const tenantId = this.tenantContext.getRequired();
    const key = body.key.trim().toUpperCase();
    const protectedFlag = SYSTEM_ONLY_FLAGS.has(key);
    this.policyEnforcement.enforceFeatureFlagUpsert({
      tenantId,
      key,
      protectedFlag,
      adminKeyHeader,
      adminRoleHeader,
    });
    try {
      const row = await this.flags.upsert(tenantId, body.key, body.value);
      emitPlaneEvent(this.structured, {
        taxonomy: 'CONTROL_PLANE_EVENT',
        correlationId: `feature-flag:${key}`,
        actor: adminRoleHeader?.trim() || 'tenant-admin',
        action: 'FEATURE_FLAG:UPSERT',
        adapter: 'feature.flags',
        message: `tenantId=${tenantId} key=${key}`,
      });
      return {
        key: row.key,
        value: JSON.parse(row.valueJson) as unknown,
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (error) {
      this.metrics.incApiErrorsTotal('feature_flags', 'upsert', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('feature_flags', 'upsert', Date.now() - started);
    }
  }

}
