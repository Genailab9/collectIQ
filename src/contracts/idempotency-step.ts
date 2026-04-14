/** Stable SMEK idempotency `step` values (PRD v1.2 §2.5). */
export const IdempotencyStep = {
  PaymentCreateBootstrap: 'payment.create_intent.bootstrap',
  PaymentCreateProcessing: 'payment.create_intent.processing',
  PaymentConfirmTransition: 'payment.confirm.transition',
  PaymentConfirmSyncBootstrap: 'payment.confirm.sync_bootstrap',
  /** Outbound post-payment sync adapter: IN_FLIGHT → CASE_FINALIZED. */
  SyncCaseFinalized: 'sync.case_finalized',
  /** Strict terminal: CASE_FINALIZED → COMPLETED (`sync.completed`). */
  SyncCompleted: 'sync.completed',
  ApprovalRegister: 'approval.register_request',
  ApprovalOfficerDecision: 'approval.officer_decision',
  ApprovalEscalationTimer: 'approval.escalation_timer',
  WebhookTwilioVoiceStatus: 'webhook.twilio.voice_status',
  /** PRD §6.3 — provider poll recovery; one SMEK hop per (tenant, correlation, observed provider status). */
  WebhookRecoveryPoll: 'webhook.recovery.poll',
  WebhookStripePaymentStatus: 'webhook.stripe.payment_status',
  WebhookStripeRefund: 'webhook.stripe.refund',
  WebhookStripeDispute: 'webhook.stripe.dispute',
  /** PRD v1.2 §4 — one SMEK(DATA) completion per ingested account row. */
  IngestionDataRecordComplete: 'ingestion.data.record_complete',
  ExecutionCallAuthenticate: 'execution.call.authenticate',
  ExecutionCallNegotiate: 'execution.call.negotiate',
  ExecutionCallSubmitForApproval: 'execution.call.submit_for_approval',
  /** PRD v1.3 — deterministic recovery when the log predates persisted SMEK idempotency metadata. */
  RecoveryDataComplete: 'recovery.data.complete',
} as const;

export type IdempotencyStep = (typeof IdempotencyStep)[keyof typeof IdempotencyStep];
