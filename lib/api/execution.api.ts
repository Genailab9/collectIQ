import { apiClient, RequestContext, withHeaders, withSafeRetry } from "./base";

export type ExecutionTrace = {
  mode?: "summary" | "full";
  traceId?: string;
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
  currentStateByMachine?: Record<string, string>;
  startedAt?: string | null;
  lastTransitionAt?: string | null;
  metrics?: {
    transitionCount: number;
    adapterErrorCount: number;
    idempotencyFailureCount: number;
    webhookReceivedCount: number;
    webhookProcessedCount: number;
  };
  errors: Array<{ source: string; at: string; detail: string }>;
};

export type ActiveExecutionItem = {
  correlationId: string;
  currentPhase: string;
  currentStateSummary: string;
  lastUpdatedAt: string;
  campaignId: string | null;
};

export async function getExecutionTrace(
  correlationId: string,
  opts: { mode?: "summary" | "full" } = {},
  context: RequestContext = {},
): Promise<ExecutionTrace> {
  const { headers } = withHeaders(context, "trace");
  const mode = opts.mode === "full" ? "full" : "summary";
  const requestHeaders =
    mode === "full"
      ? { ...headers, "X-CollectIQ-Debug": "true" }
      : headers;
  const suffix = `?mode=${mode}`;
  const { data } = await withSafeRetry(
    () =>
      apiClient.get<ExecutionTrace>(`/observability/trace/${encodeURIComponent(correlationId)}${suffix}`, {
        headers: requestHeaders,
      }),
    1,
  );
  return data;
}

export async function fetchActiveExecutions(context: RequestContext = {}): Promise<ActiveExecutionItem[]> {
  const { headers } = withHeaders(context, "execution-active");
  const { data } = await apiClient.get<ActiveExecutionItem[]>("/execution/active", { headers });
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

