import axios, { AxiosError } from "axios";

/** In-memory tenant mirror for browser UI; HttpOnly cookie is authoritative for API (BFF injects header). */
let tenantContextMemory: string | null = null;

function getTenantContextMemory(): string | null {
  return tenantContextMemory;
}

function setTenantContextMemory(tenantId: string | null): void {
  tenantContextMemory = tenantId?.trim() ? tenantId.trim() : null;
}

const DEFAULT_BFF_PREFIX = "/api/collectiq";
const configuredBffPrefix = process.env.NEXT_PUBLIC_COLLECTIQ_BFF_PATH?.trim();
if (configuredBffPrefix && configuredBffPrefix.replace(/\/$/, "") !== DEFAULT_BFF_PREFIX) {
  throw new Error(
    `Invalid NEXT_PUBLIC_COLLECTIQ_BFF_PATH "${configuredBffPrefix}". Frontend API boundary is locked to ${DEFAULT_BFF_PREFIX}.`,
  );
}
const BFF_PREFIX = DEFAULT_BFF_PREFIX;
const TENANT_HEADER = "x-collectiq-tenant-id";
const IDEMPOTENCY_HEADER = "x-idempotency-key";
const TENANT_STORAGE_KEY = "collectiq:tenantId";

export type ApiActionError = {
  status: number;
  message: string;
  detail?: unknown;
};

export type RequestContext = {
  tenantId?: string;
  idempotencyKey?: string;
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
  const fromCache = getTenantContextMemory();
  if (fromCache) {
    return fromCache;
  }
  const fromLegacyReadableCookie = readLegacyTenantCookie();
  if (fromLegacyReadableCookie) {
    return fromLegacyReadableCookie;
  }
  throw new Error("Tenant ID is required. Provide tenantId or set tenant via admin tenant switch.");
}

function extractNestMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  const m = o.message;
  if (typeof m === "string") return m;
  if (Array.isArray(m)) return m.map((x) => String(x)).join("; ");
  if (typeof o.error === "string") return o.error;
  return "";
}

function extractErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  return typeof o.code === "string" ? o.code : undefined;
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
    const seconds = retryAfter?.trim() ? Number.parseInt(retryAfter.trim(), 10) : Number.NaN;
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
      message: humanizeApiError(rawMessage, status, typeof retryAfter === "string" ? retryAfter : undefined, code),
      detail: data,
    };
  }
  if (error instanceof Error) {
    return { status: 500, message: humanizeApiError(error.message, 500) };
  }
  return { status: 500, message: "Unexpected request error.", detail: error };
}

function canAutoRetry(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status ?? 0;
  return status === 408 || status === 429 || status >= 500 || !error.response;
}

export async function withSafeRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !canAutoRetry(error)) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

export const apiClient = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  // Governance boundary: all app requests (client and server) go through BFF only.
  config.baseURL = BFF_PREFIX;
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

export function withHeaders(context: RequestContext, defaultPrefix: string) {
  const tenantId = getTenantId(context.tenantId);
  const idempotencyKey = context.idempotencyKey?.trim() || generateIdempotencyKey(defaultPrefix);
  return {
    tenantId,
    idempotencyKey,
    headers: {
      [TENANT_HEADER]: tenantId,
      [IDEMPOTENCY_HEADER]: idempotencyKey,
    },
  };
}

/**
 * Persists tenant in HttpOnly cookie via BFF and mirrors to in-memory cache for UI.
 */
export async function setApiTenantId(tenantId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const trimmed = tenantId.trim();
  if (!trimmed) {
    throw new Error("tenantId must be non-empty.");
  }
  const res = await fetch(`${BFF_PREFIX}/tenant/context`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId: trimmed }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message || `Failed to set tenant context (${res.status}).`);
  }
  setTenantContextMemory(trimmed);
  window.dispatchEvent(new CustomEvent("collectiq-tenant-changed", { detail: { tenantId: trimmed } }));
}

/** Hydrate in-memory tenant from HttpOnly cookie (call once after shell mount). */
export async function hydrateTenantContextFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(`${BFF_PREFIX}/tenant/context`, { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { tenantId?: string | null };
    const id = typeof data.tenantId === "string" ? data.tenantId.trim() : "";
    setTenantContextMemory(id.length > 0 ? id : null);
  } catch {
    // non-fatal
  }
}

function readLegacyTenantCookie(): string | null {
  if (typeof window === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TENANT_STORAGE_KEY}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(TENANT_STORAGE_KEY.length + 1)).trim();
  return value.length > 0 ? value : null;
}

export function getStoredTenantId(): string | null {
  if (typeof window === "undefined") return null;
  const mem = getTenantContextMemory();
  if (mem) return mem;
  return readLegacyTenantCookie();
}

