import { apiClient, RequestContext, withHeaders } from "./base";

export type ExecutionRetryItem = {
  correlationId: string;
  failureReason: string;
  lastState: string;
  retryCount: number;
};

export async function fetchExecutionRetries(
  params: { limit?: number; offset?: number } = {},
  context: RequestContext = {},
): Promise<ExecutionRetryItem[]> {
  const { headers } = withHeaders(context, "execution-retries");
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const { data } = await apiClient.get<ExecutionRetryItem[]>(`/api/v1/execution/retries${suffix}`, { headers });
  return data;
}

export type ApprovalSlaMetrics = {
  avgApprovalTimeMs: number;
  timeoutRate: number;
  pendingCount: number;
  breachedSlaCount: number;
};

export async function fetchApprovalSlaMetrics(context: RequestContext = {}): Promise<ApprovalSlaMetrics> {
  const { headers } = withHeaders(context, "approval-sla");
  const { data } = await apiClient.get<ApprovalSlaMetrics>("/api/v1/analytics/approvals", { headers });
  return data;
}

export type DomainEventApiItem = {
  eventId: string;
  eventType: string;
  correlationId: string;
  tenantId: string;
  timestamp: string;
  payload: unknown;
};

export async function fetchDomainEvents(
  params: { correlationId?: string; eventType?: string; limit?: number },
  context: RequestContext = {},
): Promise<{ events: DomainEventApiItem[] }> {
  const { headers } = withHeaders(context, "domain-events");
  const sp = new URLSearchParams();
  if (params.correlationId) sp.set("correlationId", params.correlationId);
  if (params.eventType) sp.set("eventType", params.eventType);
  if (params.limit != null) sp.set("limit", String(params.limit));
  const q = sp.toString();
  const { data } = await apiClient.get<{ events: DomainEventApiItem[] }>(
    `/api/v1/observability/domain-events${q ? `?${q}` : ""}`,
    { headers },
  );
  return data;
}

export async function postSystemSimulation(
  body: {
    simulatePaymentFailure?: boolean;
    simulateApprovalTimeout?: boolean;
    simulateCallFailure?: boolean;
  },
  context: RequestContext = {},
): Promise<{ ok: true; flags: Record<string, boolean> }> {
  const { headers } = withHeaders(context, "system-simulation");
  const { data } = await apiClient.post<{ ok: true; flags: Record<string, boolean> }>(
    "/api/v1/system/simulation",
    body,
    { headers },
  );
  return data;
}
