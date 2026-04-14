import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from '../feature-flags/feature-flag.service';
import { ResilienceService } from '../common/resilience/resilience.service';
import { WebhookRecoveryService, webhookRecoverySilenceMinutes } from '../recovery/webhook-recovery.service';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { AdminAuditLogService } from '../survival/admin-audit-log.service';
import { SurvivalJobsService } from '../survival/survival-jobs.service';
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
    private readonly adminAudit: AdminAuditLogService,
    private readonly survivalJobs: SurvivalJobsService,
  ) {}

  @Get('tenants')
  async listTenants() {
    return this.tenants.listAll();
  }

  @Patch('tenants/:tenantId/enabled')
  async setEnabled(
    @Param('tenantId') tenantId: string,
    @Body() body: { enabled?: boolean },
    @Headers('x-collectiq-admin-actor') actorHeader?: string,
  ) {
    const enabled = body.enabled === true;
    const out = await this.tenants.setEnabled(tenantId, enabled);
    await this.adminAudit.record({
      tenantId,
      actor: actorHeader?.trim() || 'saas-admin',
      action: 'tenant.set_enabled',
      detail: { tenantId, enabled },
    });
    return out;
  }

  @Post('recovery/trigger')
  async triggerRecovery(@Headers('x-collectiq-admin-actor') actorHeader?: string) {
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
    return { ok: true, note: 'Execution recovery worker still runs on its cron schedule.' };
  }

  @Get('system-health')
  async systemHealth() {
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
  }
}
