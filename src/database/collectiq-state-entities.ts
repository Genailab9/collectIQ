import { WebhookEventEntity } from '../adapters/telephony/webhooks/entities/webhook-event.entity';
import { TenantSaaSProfileEntity } from '../saas/entities/tenant-saas-profile.entity';
import { TenantCompliancePolicyEntity } from '../compliance/entities/tenant-compliance-policy.entity';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { TenantApprovalPolicyEntity } from '../modules/approval/entities/tenant-approval-policy.entity';
import { PaymentGatewayIntentLinkEntity } from '../modules/payment/entities/payment-gateway-intent-link.entity';
import { DataIngestionRecordEntity } from '../modules/ingestion/entities/data-ingestion-record.entity';
import { SyncCaseSnapshotEntity } from '../modules/sync/entities/sync-case-snapshot.entity';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { AdminAuditLogEntity } from '../survival/entities/admin-audit-log.entity';
import { NotificationFeedEntity } from '../survival/entities/notification-feed.entity';
import { NotificationOutboxEntity } from '../survival/entities/notification-outbox.entity';
import { SurvivalJobEntity } from '../survival/entities/survival-job.entity';
import { TenantSealedCredentialEntity } from '../survival/entities/tenant-sealed-credential.entity';
import { CampaignEntity } from '../modules/campaign/campaign.entity';
import { TenantFeatureFlagEntity } from '../modules/tenant-feature-flags/tenant-feature-flag.entity';

/** Single TypeORM entity list for the CollectIQ state store (SQLite). PRD §17 — keep in sync with migrations. */
export const COLLECTIQ_STATE_ENTITIES = [
  StateTransitionLogEntity,
  SmekOrchestrationAuditEntity,
  PaymentGatewayIntentLinkEntity,
  IdempotencyKeyEntity,
  WebhookEventEntity,
  DataIngestionRecordEntity,
  SyncCaseSnapshotEntity,
  TenantApprovalPolicyEntity,
  TenantCompliancePolicyEntity,
  TenantSaaSProfileEntity,
  NotificationOutboxEntity,
  NotificationFeedEntity,
  SurvivalJobEntity,
  AdminAuditLogEntity,
  TenantSealedCredentialEntity,
  CampaignEntity,
  TenantFeatureFlagEntity,
];
