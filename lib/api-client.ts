import { apiClient, RequestContext, withHeaders } from "./api/base";
export {
  apiClient,
  getStoredTenantId,
  hydrateTenantContextFromServer,
  setApiTenantId,
  type ApiActionError,
  type RequestContext,
} from "./api/base";
export {
  type CollectiqFeatureFlagKey,
  type CollectiqFeatureFlagsResponse,
  type DemoSeedResult,
  fetchCollectiqFeatureFlags,
  postDemoReset,
  postDemoSeed,
  upsertCollectiqFeatureFlag,
} from "./api/auth.api";
export { type CampaignDto, createCampaignApi, listCampaignsApi } from "./api/campaign.api";
export {
  type ActiveExecutionItem,
  type ExecutionTrace,
  fetchActiveExecutions,
  getExecutionTrace,
  submitForApproval,
  triggerAuthenticate,
  triggerNegotiate,
} from "./api/execution.api";
export { uploadIngestionFile } from "./api/ingestion.api";
export {
  type PendingApprovalItem,
  approveRequest,
  counterOfferRequest,
  fetchPendingApprovals,
  rejectRequest,
} from "./api/approval.api";
export { type PendingPaymentItem, confirmPayment, createPaymentIntent, fetchPendingPayments } from "./api/payment.api";
export {
  type ApprovalSlaMetrics,
  type DomainEventApiItem,
  type ExecutionRetryItem,
  fetchApprovalSlaMetrics,
  fetchDomainEvents,
  fetchExecutionRetries,
  postSystemSimulation,
} from "./api/platform.api";

export type DashboardMetrics = {
  totalCases: number;
  collectedAmountCents: number;
  recoveryRate: number;
  avgResolutionTimeMs: number;
  approvalRate: number;
};

export async function fetchDashboardMetrics(context: RequestContext = {}): Promise<DashboardMetrics> {
  const { headers } = withHeaders(context, "dashboard-metrics");
  const { data } = await apiClient.get<DashboardMetrics>("/dashboard/metrics", { headers });
  return data;
}

export async function fetchHealth(): Promise<{
  status: "ok";
  uptime: number;
  db: "connected";
  version: string;
}> {
  const { data } = await apiClient.get("/health");
  return data as { status: "ok"; uptime: number; db: "connected"; version: string };
}

export type StructuredLogEvent = {
  timestamp?: string;
  at?: string;
  result?: string;
  surface?: string;
  message?: string;
  correlationId?: string;
  phase?: string;
  adapter?: string;
};

export async function fetchStructuredLogExport(limit = 50, context: RequestContext = {}): Promise<StructuredLogEvent[]> {
  const { headers } = withHeaders(context, "structured-export");
  const { data } = await apiClient.get<{ events: StructuredLogEvent[] }>(
    `/observability/structured-log-export?limit=${encodeURIComponent(String(limit))}`,
    { headers },
  );
  return data.events ?? [];
}

export type ObservabilitySummary = {
  failuresByPhase: Record<string, number>;
  adapterErrors: number;
  adapterRetryObservations: number;
  stuckExecutions: Array<{ correlationId: string; lastOccurredAt: string; idleMinutes: number }>;
};

export async function fetchObservabilitySummary(
  context: RequestContext = {},
): Promise<ObservabilitySummary> {
  const { headers } = withHeaders(context, "observability-summary");
  const { data } = await apiClient.get<ObservabilitySummary>("/observability/summary", { headers });
  return data;
}


export type SaaSTenantMe = {
  tenantId: string;
  displayName: string;
  plan: string;
  enabled: boolean;
  usage: { cases: number; apiCalls: number; paymentsProcessed: number };
  stripe: { customerConfigured: boolean; subscriptionConfigured: boolean };
};

export async function getSaaSTenantMe(context: RequestContext = {}): Promise<SaaSTenantMe> {
  const { headers } = withHeaders(context, "saas-tenant");
  const { data } = await apiClient.get<SaaSTenantMe>("/saas/tenant/me", { headers });
  return data;
}

export async function getTenantFeatureFlags(context: RequestContext = {}): Promise<Record<string, boolean>> {
  const { headers } = withHeaders(context, "saas-flags");
  const { data } = await apiClient.get<Record<string, boolean>>("/saas/tenant/feature-flags", { headers });
  return data;
}

export async function getBillingSummary(context: RequestContext = {}): Promise<{
  plan: string;
  usage: { cases: number; apiCalls: number; paymentsProcessed: number };
  limits: { cases: number | null; apiCalls: number | null; payments: number | null };
}> {
  const { headers } = withHeaders(context, "billing-summary");
  const { data } = await apiClient.get("/saas/billing/summary", { headers });
  return data;
}

export async function createBillingCheckoutSession(
  plan: "pro" | "enterprise",
  context: RequestContext = {},
): Promise<{ url: string | null }> {
  const { headers } = withHeaders(context, "billing-checkout");
  const { data } = await apiClient.post<{ url: string | null }>(
    "/saas/billing/checkout-session",
    { plan },
    { headers },
  );
  return data;
}

export async function getAnalyticsDashboard(days?: number, context: RequestContext = {}) {
  const { headers } = withHeaders(context, "analytics-dashboard");
  const { data } = await apiClient.get(`/analytics/dashboard${days != null ? `?days=${days}` : ""}`, {
    headers,
  });
  return data as {
    tenantId: string;
    windowDays: number;
    sinceIso: string;
    caseCount: number;
    paymentSuccessDistinct: number;
    latestStateByMachine: Record<string, Record<string, number>>;
    transitionTotalsByMachine: Record<string, number>;
    auditRowCount: number;
    complianceAuditRows: number;
  };
}

export async function getAnalyticsCampaign(campaignId: string, context: RequestContext = {}) {
  const { headers } = withHeaders(context, "analytics-campaign");
  const { data } = await apiClient.get(`/analytics/campaign/${encodeURIComponent(campaignId)}`, { headers });
  return data as {
    tenantId: string;
    campaignId: string;
    correlationIds: string[];
    aggregates: {
      caseCount: number;
      paymentSuccessDistinct: number;
      latestStateByMachine: Record<string, Record<string, number>>;
    };
  };
}

export type AuthUser = {
  username: string;
  role: "admin" | "operator";
};

export async function loginCollectiq(username: string, password: string): Promise<void> {
  await apiClient.post("/auth/login", { username, password });
}

export async function logoutCollectiq(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function getAuthUser(): Promise<AuthUser> {
  const { data } = await apiClient.get<AuthUser>("/auth/me");
  return data;
}

export async function activateOnboarding(): Promise<void> {
  await apiClient.post("/onboarding/activate");
}

export type AdminTenantRow = {
  tenantId: string;
  displayName: string;
  plan: string;
  enabled: boolean;
  caseCount: number;
  apiCallCount: number;
  paymentProcessedCount: number;
};

export async function fetchAdminTenants(): Promise<AdminTenantRow[]> {
  const { data } = await apiClient.get<AdminTenantRow[]>("/admin/tenants");
  return data;
}

export async function triggerAdminRecovery(): Promise<{ ok?: boolean; note?: string }> {
  const { data } = await apiClient.post<{ ok?: boolean; note?: string }>("/admin/recovery");
  return data;
}

export async function setAdminTenantEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await apiClient.patch(`/admin/tenants/${encodeURIComponent(tenantId)}/enabled`, { enabled });
}

export type AdminSystemHealth = {
  recoveryWorkerEnabled: boolean;
  webhookRecoveryEnabled: boolean;
  featureFlags: Record<string, boolean>;
  circuits: Array<{ circuitKey: string; consecutiveFailures: number; circuitOpenUntilIso: string | null }>;
  metricsSample: string;
};

export async function fetchAdminSystemHealth(): Promise<AdminSystemHealth> {
  const { data } = await apiClient.get<AdminSystemHealth>("/admin/health");
  return data;
}

export async function getSurvivalJobsSummary(context: RequestContext = {}) {
  const { headers } = withHeaders(context, "survival-jobs");
  const { data } = await apiClient.get("/survival/jobs/summary", { headers });
  return data as {
    byQueue: Record<string, { pending: number; running: number; failed: number; dead: number; completed: number }>;
    recent: Array<{
      id: string;
      queue: string;
      name: string;
      status: string;
      attempts: number;
      createdAt: string;
      lastError: string | null;
    }>;
  };
}

export async function downloadAuditReport(
  correlationId: string,
  context: RequestContext = {},
): Promise<Blob> {
  const { headers } = withHeaders(context, "audit-export");
  const { data } = await apiClient.get<Blob>(
    `/saas/audit/export/${encodeURIComponent(correlationId)}`,
    {
      headers,
      responseType: "blob",
    },
  );
  return data;
}

