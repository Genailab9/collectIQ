import axios, { AxiosError } from "axios";

const baseURL = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
const TENANT_HEADER = "x-collectiq-tenant-id";
const IDEMPOTENCY_HEADER = "x-idempotency-key";
const TENANT_STORAGE_KEY = "collectiq:tenantId";
const EXECUTION_API_KEY = process.env.NEXT_PUBLIC_COLLECTIQ_API_KEY?.trim();

export type ApiActionError = {
  status: number;
  message: string;
  detail?: unknown;
};

type RequestContext = {
  tenantId?: string;
  idempotencyKey?: string;
};

type Decision = "APPROVE" | "REJECT";

export type ExecutionTrace = {
  tenantId: string;
  correlationId: string;
  transitions: Array<{
    occurredAt: string;
    machine: string;
    from: string;
    to: string;
    actor: string | null;
    metadataJson: string | null;
  }>;
  adapterCalls: Array<{
    createdAt: string;
    auditKind: string;
    executionPhase: string;
    payload: unknown;
  }>;
  errors: Array<{ source: string; at: string; detail: string }>;
};

function generateIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function getTenantId(tenantId?: string): string {
  const explicit = tenantId?.trim();
  if (explicit) {
    return explicit;
  }
  if (typeof window !== "undefined") {
    const fromStorage = window.localStorage.getItem(TENANT_STORAGE_KEY)?.trim();
    if (fromStorage) {
      return fromStorage;
    }
  }
  throw new Error(
    "Tenant ID is required. Provide tenantId or set localStorage collectiq:tenantId.",
  );
}

function extractNestMessage(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const o = data as Record<string, unknown>;
  const m = o.message;
  if (typeof m === "string") {
    return m;
  }
  if (Array.isArray(m)) {
    return m.map((x) => String(x)).join("; ");
  }
  if (typeof o.error === "string") {
    return o.error;
  }
  return "";
}

function extractErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const o = data as Record<string, unknown>;
  if (typeof o.code === "string") {
    return o.code;
  }
  return undefined;
}

function normalizeApiError(error: unknown): ApiActionError {
  if (axios.isAxiosError(error)) {
    const e = error as AxiosError<Record<string, unknown>>;
    const status = e.response?.status ?? 500;
    const data = e.response?.data;
    const fromNest = extractNestMessage(data);
    const rawMessage =
      (typeof fromNest === "string" && fromNest.length > 0 ? fromNest : undefined) ||
      (typeof data?.error === "string" ? data.error : undefined) ||
      e.message ||
      "Request failed";
    const code = extractErrorCode(data);
    const retryAfterRaw = e.response?.headers?.["retry-after"];
    const retryAfter = Array.isArray(retryAfterRaw) ? retryAfterRaw[0] : retryAfterRaw;
    return {
      status,
      message: humanizeApiError(
        rawMessage,
        status,
        typeof retryAfter === "string" ? retryAfter : undefined,
        code,
      ),
      detail: data,
    };
  }
  if (error instanceof Error) {
    return { status: 500, message: humanizeApiError(error.message, 500) };
  }
  return { status: 500, message: "Unexpected request error.", detail: error };
}

function humanizeApiError(message: string, status: number, retryAfter?: string, code?: string): string {
  const normalized = message.toLowerCase();
  const c = (code ?? "").toLowerCase();
  if (
    c === "compliance_block" ||
    c === "compliance_blocked" ||
    normalized.includes("compliance_block") ||
    normalized.includes("compliance_blocked")
  ) {
    return "This action is blocked by compliance rules (for example call windows, consent, or policy limits). Adjust inputs or try again when allowed.";
  }
  if (c === "idempotency_conflict" || normalized.includes("idempotency_conflict")) {
    return "This request was already received with the same idempotency key. Refresh the page to see the latest state; do not resubmit the same operation.";
  }
  if (c === "rate_limit" || status === 429 || normalized.includes("rate limit") || normalized.includes("rate_limit")) {
    const seconds = retryAfter?.trim() ? Number.parseInt(retryAfter.trim(), 10) : NaN;
    const hint =
      Number.isFinite(seconds) && seconds > 0
        ? ` Please wait about ${seconds} seconds before retrying.`
        : retryAfter && retryAfter.trim().length > 0
          ? ` Please wait about ${retryAfter.trim()} seconds before retrying.`
          : " Wait a few seconds before retrying.";
    return `Too many requests.${hint}`;
  }
  if (normalized.includes("compliance") || normalized.includes("forbidden")) {
    return "Action blocked by compliance policy. Review call windows, retry limits, or approval rules.";
  }
  if (normalized.includes("idempotency")) {
    return "This request was already processed. Refresh and verify current state before retrying.";
  }
  return message;
}

function canAutoRetry(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status ?? 0;
  return status === 408 || status === 429 || status >= 500 || !error.response;
}

async function withSafeRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !canAutoRetry(error)) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

export const apiClient = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  if (EXECUTION_API_KEY) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)["X-CollectIQ-Api-Key"] = EXECUTION_API_KEY;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = normalizeApiError(error);
    if (typeof window !== "undefined") {
      if (normalized.status === 401 && !window.location.pathname.startsWith("/login")) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}`);
      }
      window.dispatchEvent(new CustomEvent("collectiq-api-error", { detail: normalized }));
    }
    return Promise.reject(normalized);
  },
);

function withHeaders(context: RequestContext, defaultPrefix: string) {
  const tenantId = getTenantId(context.tenantId);
  const idempotencyKey =
    context.idempotencyKey?.trim() || generateIdempotencyKey(defaultPrefix);
  return {
    tenantId,
    idempotencyKey,
    headers: {
      [TENANT_HEADER]: tenantId,
      [IDEMPOTENCY_HEADER]: idempotencyKey,
    },
  };
}

export function setApiTenantId(tenantId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId.trim());
}

export function getStoredTenantId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const v = window.localStorage.getItem(TENANT_STORAGE_KEY)?.trim();
  return v && v.length > 0 ? v : null;
}

export async function getExecutionTrace(
  correlationId: string,
  context: RequestContext = {},
): Promise<ExecutionTrace> {
  const { headers } = withHeaders(context, "trace");
  const { data } = await withSafeRetry(
    () =>
      apiClient.get<ExecutionTrace>(
        `/observability/trace/${encodeURIComponent(correlationId)}`,
        { headers },
      ),
    1,
  );
  return data;
}

export async function triggerAuthenticate(input: {
  correlationId: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<void> {
  const { idempotencyKey, headers } = withHeaders(input, "authenticate");
  await apiClient.post(
    "/execution/call/authenticate",
    {
      correlationId: input.correlationId,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
}

export async function triggerNegotiate(input: {
  correlationId: string;
  conversationTranscript: string;
  accountFacts?: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<unknown> {
  const { idempotencyKey, headers } = withHeaders(input, "negotiate");
  const { data } = await apiClient.post(
    "/execution/call/negotiate",
    {
      correlationId: input.correlationId,
      conversationTranscript: input.conversationTranscript,
      accountFacts: input.accountFacts,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
  return data;
}

export async function submitForApproval(input: {
  correlationId: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<void> {
  const { idempotencyKey, headers } = withHeaders(input, "submit-approval");
  await apiClient.post(
    "/execution/call/submit-for-approval",
    {
      correlationId: input.correlationId,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
}

async function sendDecision(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  decision: Decision;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<unknown> {
  const { idempotencyKey, headers } = withHeaders(input, `decision-${input.decision.toLowerCase()}`);
  const { data } = await apiClient.post(
    `/approvals/${encodeURIComponent(input.correlationId)}/decisions`,
    {
      fromState: input.fromState,
      decision: input.decision,
      officerId: input.officerId,
      idempotencyKey,
    },
    { headers },
  );
  return data;
}

export function approveRequest(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  tenantId?: string;
  idempotencyKey?: string;
}) {
  return sendDecision({ ...input, decision: "APPROVE" });
}

export function rejectRequest(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  tenantId?: string;
  idempotencyKey?: string;
}) {
  return sendDecision({ ...input, decision: "REJECT" });
}

export async function createPaymentIntent(input: {
  amountCents: number;
  approvalCorrelationId: string;
  currency?: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<{ paymentId: string; toState: string; gatewayPaymentIntentId: string }> {
  const { idempotencyKey, headers } = withHeaders(input, "payment-intent");
  const { data } = await apiClient.post<{ paymentId: string; toState: string; gatewayPaymentIntentId: string }>(
    "/payments/intents",
    {
      amountCents: input.amountCents,
      approvalCorrelationId: input.approvalCorrelationId,
      currency: input.currency,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
  return data;
}

export async function confirmPayment(input: {
  paymentId: string;
  gatewayPaymentIntentId: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<{ toState: string }> {
  const { idempotencyKey, headers } = withHeaders(input, "payment-confirm");
  const { data } = await apiClient.post<{ toState: string }>(
    `/payments/${encodeURIComponent(input.paymentId)}/confirm`,
    {
      gatewayPaymentIntentId: input.gatewayPaymentIntentId,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
  return data;
}

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

export type PendingApprovalItem = {
  correlationId: string;
  tenantId: string;
  borrower: { name?: string; phone?: string; accountNumber?: string };
  negotiatedAmountCents: number | null;
  priority: { score?: number; label?: string } | null;
  currentState: string;
  queueStage: "WAITING_APPROVAL";
};

export async function fetchPendingApprovals(context: RequestContext = {}): Promise<PendingApprovalItem[]> {
  const { headers } = withHeaders(context, "approvals-pending");
  const { data } = await apiClient.get<PendingApprovalItem[]>("/approvals/pending", { headers });
  return data;
}

export type ActiveExecutionItem = {
  correlationId: string;
  currentPhase: string;
  currentStateSummary: string;
  lastUpdatedAt: string;
  campaignId: string | null;
};

export async function fetchActiveExecutions(context: RequestContext = {}): Promise<ActiveExecutionItem[]> {
  const { headers } = withHeaders(context, "execution-active");
  const { data } = await apiClient.get<ActiveExecutionItem[]>("/execution/active", { headers });
  return data;
}

export type PendingPaymentItem = {
  correlationId: string;
  paymentId: string;
  amountCents: number | null;
  currentState: string;
};

export async function fetchPendingPayments(context: RequestContext = {}): Promise<PendingPaymentItem[]> {
  const { headers } = withHeaders(context, "payments-pending");
  const { data } = await apiClient.get<PendingPaymentItem[]>("/payments/pending", { headers });
  return data;
}

export type CampaignDto = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export async function listCampaignsApi(context: RequestContext = {}): Promise<CampaignDto[]> {
  const { headers } = withHeaders(context, "campaigns-list");
  const { data } = await apiClient.get<CampaignDto[]>("/campaigns", { headers });
  return data;
}

export async function createCampaignApi(
  input: { name: string; description?: string | null } & RequestContext,
): Promise<CampaignDto> {
  const { headers } = withHeaders(input, "campaign-create");
  const { data } = await apiClient.post<CampaignDto>(
    "/campaigns",
    {
      name: input.name,
      ...(input.description != null ? { description: input.description } : {}),
    },
    { headers },
  );
  return data;
}

export type CollectiqFeatureFlagsResponse = {
  flags: Record<string, unknown>;
  rows: unknown[];
};

export async function fetchCollectiqFeatureFlags(
  context: RequestContext = {},
): Promise<CollectiqFeatureFlagsResponse> {
  const { headers } = withHeaders(context, "feature-flags-list");
  const { data } = await apiClient.get<CollectiqFeatureFlagsResponse>("/feature-flags", { headers });
  return data;
}

export type CollectiqFeatureFlagKey = "SIMULATE_CALLS" | "FORCE_PAYMENT_SUCCESS" | "DEMO_MODE";

export async function upsertCollectiqFeatureFlag(
  input: { key: CollectiqFeatureFlagKey; value: unknown } & RequestContext,
): Promise<{ key: string; value: unknown; updatedAt: string }> {
  const { headers } = withHeaders(input, `feature-flag-${input.key}`);
  const { data } = await apiClient.post<{ key: string; value: unknown; updatedAt: string }>(
    "/feature-flags",
    { key: input.key, value: input.value },
    { headers },
  );
  return data;
}

export type DemoSeedResult = {
  campaignId: string;
  approvalCorrelationIds: readonly string[];
  paymentIds: readonly string[];
};

export async function postDemoSeed(context: RequestContext = {}): Promise<DemoSeedResult> {
  const { headers } = withHeaders(context, "demo-seed");
  const { data } = await apiClient.post<DemoSeedResult>("/demo/seed", {}, { headers });
  return data;
}

export async function postDemoReset(context: RequestContext = {}): Promise<{ deletedCorrelationIds: number }> {
  const { headers } = withHeaders(context, "demo-reset");
  const { data } = await apiClient.post<{ deletedCorrelationIds: number }>("/demo/reset", {}, { headers });
  return data;
}

export async function uploadIngestionFile(input: {
  accounts: unknown[];
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
  /** Server campaign UUID; required for campaign-first ingestion. */
  campaignId?: string;
}): Promise<{
  accepted: Array<{ index: number; correlation_id: string; record_id: string }>;
  rejected: Array<{ index: number; reason: string }>;
}> {
  const { idempotencyKey, headers } = withHeaders(input, "ingestion-upload");
  const { data } = await apiClient.post<{
    accepted: Array<{ index: number; correlation_id: string; record_id: string }>;
    rejected: Array<{ index: number; reason: string }>;
  }>(
    "/ingestion/upload",
    {
      idempotency_key: idempotencyKey,
      accounts: input.accounts,
      borrower_opted_out: input.borrowerOptedOut,
      ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
    },
    { headers },
  );
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

