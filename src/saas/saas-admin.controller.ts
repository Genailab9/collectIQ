import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from '../feature-flags/feature-flag.service';
import { ResilienceService } from '../common/resilience/resilience.service';
import { WebhookRecoveryService, webhookRecoverySilenceMinutes } from '../recovery/webhook-recovery.service';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { AdminAuditLogService } from '../survival/admin-audit-log.service';
import { SurvivalJobsService } from '../survival/survival-jobs.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { emitPlaneEvent } from '../observability/control-plane-event';
import { SaaSAdminGuard } from './saas-admin.guard';
import { SaaSTenantService } from './saas-tenant.service';

@Controller('saas/admin')
@UseGuards(SaaSAdminGuard)
export class SaaSAdminController {
  constructor(
    private readonly tenants: SaaSTenantService,
    private readonly webhookRecovery: WebhookRecoveryService,
    private readonly config: ConfigService,
    private readonly featureFlags: FeatureFlagService,
    private readonly resilience: ResilienceService,
    private readonly metrics: PrometheusMetricsService,
    private readonly structured: StructuredLoggerService,
    private readonly adminAudit: AdminAuditLogService,
    private readonly survivalJobs: SurvivalJobsService,
    private readonly policyEnforcement: PolicyEnforcementService,
  ) {}

  @Get('tenants')
  async listTenants(
    @Headers('x-collectiq-admin-key') adminKeyHeader?: string,
    @Headers('x-collectiq-admin-role') adminRoleHeader?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('admin', 'list_tenants');
    this.policyEnforcement.enforceAdminOperation({
      correlationId: 'tenants-list',
      operationType: 'READ',
      resourceType: 'TENANT',
      riskTier: 'MEDIUM',
      adminKeyHeader,
      adminRoleHeader,
    });
    try {
      return this.tenants.listAll();
    } catch (error) {
      this.metrics.incApiErrorsTotal('admin', 'list_tenants', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('admin', 'list_tenants', Date.now() - started);
    }
  }

  @Patch('tenants/:tenantId/enabled')
  async setEnabled(
    @Param('tenantId') tenantId: string,
    @Body() body: { enabled?: boolean },
    @Headers('x-collectiq-admin-key') adminKeyHeader?: string,
    @Headers('x-collectiq-admin-role') adminRoleHeader?: string,
    @Headers('x-collectiq-admin-actor') actorHeader?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('admin', 'set_tenant_enabled');
    const enabled = body.enabled === true;
    this.policyEnforcement.enforceAdminOperation({
      tenantId,
      correlationId: `tenant-enabled:${tenantId}`,
      operationType: 'WRITE',
      resourceType: 'TENANT',
      riskTier: 'HIGH',
      adminKeyHeader,
      adminRoleHeader,
    });
    try {
      const out = await this.tenants.setEnabled(tenantId, enabled);
      await this.adminAudit.record({
        tenantId,
        actor: actorHeader?.trim() || 'saas-admin',
        action: 'tenant.set_enabled',
        detail: { tenantId, enabled },
      });
      emitPlaneEvent(this.structured, {
        taxonomy: 'CONTROL_PLANE_EVENT',
        correlationId: `tenant-enabled:${tenantId}`,
        actor: actorHeader?.trim() || 'saas-admin',
        action: 'TENANT:SET_ENABLED',
        adapter: 'saas.admin',
        message: `actor=${actorHeader?.trim() || 'saas-admin'} tenantId=${tenantId} enabled=${enabled ? 'true' : 'false'}`,
      });
      return out;
    } catch (error) {
      this.metrics.incApiErrorsTotal('admin', 'set_tenant_enabled', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('admin', 'set_tenant_enabled', Date.now() - started);
    }
  }

  @Post('recovery/trigger')
  async triggerRecovery(
    @Headers('x-collectiq-admin-key') adminKeyHeader?: string,
    @Headers('x-collectiq-admin-role') adminRoleHeader?: string,
    @Headers('x-collectiq-admin-actor') actorHeader?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('admin', 'trigger_recovery');
    this.policyEnforcement.enforceAdminOperation({
      correlationId: 'recovery-trigger',
      operationType: 'EXECUTE',
      resourceType: 'SYSTEM',
      riskTier: 'HIGH',
      adminKeyHeader,
      adminRoleHeader,
    });
    try {
      await this.webhookRecovery.recoverMissingWebhooksSince(
        new Date(Date.now() - webhookRecoverySilenceMinutes(this.config) * 60_000),
        50,
      );
      await this.survivalJobs.enqueue({
        queue: 'webhook-recovery',
        name: 'admin-trigger',
        payload: { source: 'saas-admin' },
      });
      await this.adminAudit.record({
        actor: actorHeader?.trim() || 'saas-admin',
        action: 'recovery.trigger',
        detail: { kind: 'webhook_recovery' },
      });
      emitPlaneEvent(this.structured, {
        taxonomy: 'SYSTEM_PLANE_EVENT',
        correlationId: 'recovery-trigger',
        actor: actorHeader?.trim() || 'saas-admin',
        action: 'SYSTEM:RECOVERY_TRIGGER',
        adapter: 'saas.admin',
        message: `actor=${actorHeader?.trim() || 'saas-admin'} kind=webhook_recovery`,
      });
      return { ok: true, note: 'Execution recovery worker still runs on its cron schedule.' };
    } catch (error) {
      this.metrics.incApiErrorsTotal('admin', 'trigger_recovery', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('admin', 'trigger_recovery', Date.now() - started);
    }
  }

  @Get('system-health')
  async systemHealth(
    @Headers('x-collectiq-admin-key') adminKeyHeader?: string,
    @Headers('x-collectiq-admin-role') adminRoleHeader?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('admin', 'system_health');
    this.policyEnforcement.enforceAdminOperation({
      correlationId: 'system-health',
      operationType: 'READ',
      resourceType: 'SYSTEM',
      riskTier: 'MEDIUM',
      adminKeyHeader,
      adminRoleHeader,
    });
    try {
      const recoveryEnabled = (this.config.get<string>('RECOVERY_WORKER_ENABLED', 'true') ?? 'true')
      .toLowerCase()
      .trim();
      const webhookRecoveryEnabled = (
        this.config.get<string>('WEBHOOK_RECOVERY_ENABLED', 'true') ?? 'true'
      )
      .toLowerCase()
      .trim();
      let prometheusSample = '';
      try {
        prometheusSample = this.metrics.renderPrometheusText().split('\n').slice(0, 40).join('\n');
      } catch {
        prometheusSample = 'unavailable';
      }
      return {
        recoveryWorkerEnabled: recoveryEnabled !== 'false' && recoveryEnabled !== '0',
        webhookRecoveryEnabled: webhookRecoveryEnabled !== 'false' && webhookRecoveryEnabled !== '0',
        featureFlags: this.featureFlags.getKnownFlagsSnapshot(),
        circuits: this.resilience.getCircuitDiagnostics(),
        metricsSample: prometheusSample,
      };
    } catch (error) {
      this.metrics.incApiErrorsTotal('admin', 'system_health', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('admin', 'system_health', Date.now() - started);
    }
  }

}
