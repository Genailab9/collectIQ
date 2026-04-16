import { apiClient, RequestContext, withHeaders } from "./base";

export type CollectiqFeatureFlagsResponse = {
  flags: Record<string, unknown>;
  rows: unknown[];
};

export type CollectiqFeatureFlagKey = "SIMULATE_CALLS" | "FORCE_PAYMENT_SUCCESS" | "DEMO_MODE";

export type DemoSeedResult = {
  campaignId: string;
  approvalCorrelationIds: readonly string[];
  paymentIds: readonly string[];
};

export async function fetchCollectiqFeatureFlags(
  context: RequestContext = {},
): Promise<CollectiqFeatureFlagsResponse> {
  const { headers } = withHeaders(context, "feature-flags-list");
  const { data } = await apiClient.get<CollectiqFeatureFlagsResponse>("/feature-flags", { headers });
  return data;
}

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

