export function getBackendBaseUrl(): string {
  const base =
    process.env.COLLECTIQ_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "";
  if (!base) {
    throw new Error("Missing API base URL. Set NEXT_PUBLIC_API_URL (and COLLECTIQ_API_BASE_URL for server routes).");
  }
  return base;
}

export function getServerExecutionHeaders(tenantId?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = process.env.COLLECTIQ_API_KEY?.trim();
  if (apiKey) {
    headers["X-CollectIQ-Api-Key"] = apiKey;
  }
  if (tenantId?.trim()) {
    headers["X-CollectIQ-Tenant-Id"] = tenantId.trim();
  }
  return headers;
}
