import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { AiAdapterModule } from './adapters/ai/ai-adapter.module';
import { ApprovalAdapterModule } from './adapters/approval/approval-adapter.module';
import { PaymentAdapterModule } from './adapters/payment/payment-adapter.module';
import { PaymentWebhookModule } from './adapters/payment/webhooks/payment-webhook.module';
import { SyncAdapterModule } from './adapters/sync/sync-adapter.module';
import { TelephonyAdapterModule } from './adapters/telephony/telephony-adapter.module';
import { TelephonyWebhookModule } from './adapters/telephony/webhooks/telephony-webhook.module';
import { DataLifecycleModule } from './data-lifecycle/data-lifecycle.module';
import { ResilienceModule } from './common/resilience/resilience.module';
import { ComplianceModule } from './compliance/compliance.module';
import { COLLECTIQ_STATE_ENTITIES } from './database/collectiq-state-entities';
import { CampaignModule } from './modules/campaign/campaign.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DataIngestionModule } from './modules/ingestion/data-ingestion.module';
import { DemoModule } from './modules/demo/demo.module';
import { TenantFeatureFlagModule } from './modules/tenant-feature-flags/tenant-feature-flag.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { KernelModule } from './kernel/kernel.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ObservabilityModule } from './observability/observability.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RecoveryModule } from './recovery/recovery.module';
import { PrdSecurityMiddleware } from './security/prd-security.middleware';
import { SecurityModule } from './security/security.module';
import { SettlementExecutionModule } from './modules/settlement-execution/settlement-execution.module';
import { FeatureFlagModule } from './feature-flags/feature-flag.module';
import { StateMachineModule } from './state-machine/state-machine.module';
import { TenantIsolationGuard } from './tenant/tenant-isolation.guard';
import { TenantIsolationSubscriber } from './tenant/tenant-isolation.subscriber';
import { TenantMiddleware } from './tenant/tenant.middleware';
import { TenantModule } from './tenant/tenant.module';
import { SaaSAdminModule } from './saas/saas-admin.module';
import { SaaSCoreModule } from './saas/saas-core.module';
import { SurvivalModule } from './survival/survival.module';
import { SaaSTenantStatusMiddleware } from './saas/saas-tenant-status.middleware';
import { SaaSUsageMiddleware } from './saas/saas-usage.middleware';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';

/**
 * Single application root. Execution semantics:
 * - SMEK (`SmekKernelService.executeLoop`) is the only path that validates compliance,
 *   persists transitions, and invokes outbound adapters.
 * - State machines register at boot via `MachineRegistryService` (DATA, CALL, APPROVAL, PAYMENT, SYNC).
 * - Domain modules depend on `KernelModule` and must not call `StateMachineService` for writes.
 * - Step 8 / PRD §2.2: no event-driven execution engines; allowed triggers are inbound HTTP → SMEK and
 *   Nest `@Cron` jobs that only read the transition log and call module facades that delegate to SMEK.
 * - Step 10 / PRD §10: `DataLifecycleModule` — optional AES-256-GCM on SMEK audit payloads (`COLLECTIQ_DATA_KEY`)
 *   and PRD retention constants (no non-SMEK state mutation).
 * - Step 12 / PRD §12: orchestration audit kinds are OUTPUT ONLY (`KERNEL_LOOP_OUTPUT`, `KERNEL_ADAPTER_RESULT`);
 *   nothing may call SMEK or mutate business state in reaction to those rows.
 * - Step 13 / PRD §13: `PrdSystemValidityService` asserts on bootstrap that the machine registry is sealed and
 *   exposes exactly CALL/APPROVAL/PAYMENT/SYNC (shape is enforced at registration time).
 * - PRD §12: `ObservabilityModule` — structured JSON logs, `GET /observability/trace/:correlationId`, and `GET /metrics` (Prometheus).
 * - PRD §14: `RateLimitModule` — per-tenant `RateLimiterService` (calls/min, payments/sec); delays SMEK when over limit (`RATE_LIMIT_*`).
 * - PRD v1.3 §13: `RecoveryWorker` — `RECOVERY_TIMEOUT_MINUTES` (default 5), optional `RECOVERY_WORKER_ENABLED=false` to disable cron.
 * - PRD §5: `ResilienceService` — `RESILIENCE_FAILURE_THRESHOLD` (default 5), `RESILIENCE_COOLDOWN_MS` (default 60000); adapter bridges use bounded retries only when idempotent-safe.
 * - PRD §7: `PaymentGatewayIntentLinkEntity` — unique `gateway_payment_intent_id`; `PaymentService` never trusts client payment state (provider + persisted binding).
 * - PRD §6: `TwilioWebhookService` — CALL `from` only from `state_transition_log`; duplicate Twilio posts are HTTP 200 no-ops; disallowed edges are ignored (logged).
 * - PRD §6.3: `WebhookRecoveryService` + worker — `WEBHOOK_RECOVERY_SILENCE_MINUTES` (default 3), `WEBHOOK_RECOVERY_ENABLED`; polls Twilio/Stripe then SMEK with `WebhookRecoveryPoll` idempotency.
 * - PRD v1.2 §5: `TenantModule` + `TenantMiddleware` — `X-CollectIQ-Tenant-Id` (API) or transition-log resolution (webhooks).
 * - PRD §15: `TenantIsolationGuard` + `TenantIsolationSubscriber` + `tenant-isolation.policy` — tenant ALS required on API routes;
 *   writes must include `tenantId`; webhooks resolve tenant (and may narrow via `TWILIO_ACCOUNT_SID_TO_TENANT_JSON`)
 *   so transition-log lookups include `tenant_id` before SMEK.
 * - PRD §16: `SecurityModule` — `PrdSecurityMiddleware` (TLS via `COLLECTIQ_REQUIRE_TLS`, API key via `COLLECTIQ_API_KEY` / legacy
 *   `COLLECTIQ_EXECUTION_API_KEY`), `PiiEncryptionService` (`COLLECTIQ_PII_KEY` or `COLLECTIQ_DATA_KEY`); secrets only from env.
 * - PRD §17: `FeatureFlagModule` — `COLLECTIQ_FEATURE_*` env toggles; `ResilienceService` respects `RESILIENCE_RETRIES` / `RESILIENCE_CIRCUIT`.
 *   TypeORM: backward-compatible migrations in `src/migrations/` (`npm run migration:run`); production use `TYPEORM_SYNC=false` and
 *   optional `TYPEORM_MIGRATIONS_RUN=true` after `migration:run` in deploy (additive DDL only).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    FeatureFlagModule,
    SecurityModule,
    ObservabilityModule,
    RateLimitModule,
    ResilienceModule,
    TenantModule,
    IdempotencyModule,
    DataLifecycleModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database:
        process.env.COLLECTIQ_STATE_DB_PATH?.trim() ||
        join(process.cwd(), 'data', 'collectiq-state.db'),
      entities: COLLECTIQ_STATE_ENTITIES,
      synchronize: process.env.TYPEORM_SYNC !== 'false',
      migrations: [join(__dirname, 'migrations', '*.js')],
      migrationsRun: process.env.TYPEORM_MIGRATIONS_RUN === 'true',
      logging: process.env.TYPEORM_LOGGING === 'true',
      subscribers: [TenantIsolationSubscriber],
    }),
    TelephonyAdapterModule,
    AiAdapterModule,
    PaymentAdapterModule,
    PaymentWebhookModule,
    ApprovalAdapterModule,
    SyncAdapterModule,
    StateMachineModule,
    ComplianceModule,
    KernelModule,
    TelephonyWebhookModule,
    ApprovalModule,
    PaymentModule,
    SettlementExecutionModule,
    DataIngestionModule,
    CampaignModule,
    DashboardModule,
    TenantFeatureFlagModule,
    DemoModule,
    HealthModule,
    RecoveryModule,
    SaaSCoreModule,
    SaaSAdminModule,
    SurvivalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: TenantIsolationGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PrdSecurityMiddleware)
      .exclude({ path: '*', method: RequestMethod.OPTIONS })
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(TenantMiddleware)
      .exclude({ path: '*', method: RequestMethod.OPTIONS })
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(SaaSTenantStatusMiddleware, SaaSUsageMiddleware)
      .exclude({ path: '*', method: RequestMethod.OPTIONS })
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
