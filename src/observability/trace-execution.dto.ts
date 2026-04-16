export interface ExecutionTransitionTraceDto {
  readonly occurredAt: string;
  readonly machine: string;
  readonly from: string;
  readonly to: string;
  readonly actor: string | null;
  readonly metadataJson: string | null;
}

export interface ExecutionAdapterCallTraceDto {
  readonly createdAt: string;
  readonly auditKind: string;
  readonly executionPhase: string;
  readonly payload: unknown;
}

export interface ExecutionErrorTraceDto {
  readonly source: string;
  readonly at: string;
  readonly detail: string;
}

export interface ExecutionWebhookTraceDto {
  readonly createdAt: string;
  readonly provider: string;
  readonly stage: 'WEBHOOK_RECEIVED' | 'WEBHOOK_PROCESSED';
  readonly externalDedupeKey: string;
  readonly processed: boolean;
  readonly rawPayload: unknown;
  readonly normalizedEvent: unknown;
}

export interface ExecutionTraceDto {
  readonly mode: 'full';
  readonly traceId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly transitions: ExecutionTransitionTraceDto[];
  readonly adapterCalls: ExecutionAdapterCallTraceDto[];
  readonly webhookEvents: ExecutionWebhookTraceDto[];
  readonly errors: ExecutionErrorTraceDto[];
}

export interface ExecutionTraceSummaryDto {
  readonly mode: 'summary';
  readonly traceId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly transitions: ExecutionTransitionTraceDto[];
  readonly currentStateByMachine: Record<string, string>;
  readonly startedAt: string | null;
  readonly lastTransitionAt: string | null;
  readonly metrics: {
    readonly transitionCount: number;
    readonly adapterErrorCount: number;
    readonly idempotencyFailureCount: number;
    readonly webhookReceivedCount: number;
    readonly webhookProcessedCount: number;
  };
  readonly errors: ExecutionErrorTraceDto[];
}
