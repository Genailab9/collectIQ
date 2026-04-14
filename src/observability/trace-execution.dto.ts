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

export interface ExecutionTraceDto {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly transitions: ExecutionTransitionTraceDto[];
  readonly adapterCalls: ExecutionAdapterCallTraceDto[];
  readonly errors: ExecutionErrorTraceDto[];
}
