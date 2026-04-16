"use client";

export type FrontendTelemetryMetric =
  | "frontend_projection_lag_ms"
  | "frontend_sse_reconnect_total"
  | "frontend_sse_drop_total"
  | "frontend_polling_fallback_activated_total"
  | "frontend_stale_snapshot_minutes";

const metricRegistry: Record<FrontendTelemetryMetric, number> = {
  frontend_projection_lag_ms: 0,
  frontend_sse_reconnect_total: 0,
  frontend_sse_drop_total: 0,
  frontend_polling_fallback_activated_total: 0,
  frontend_stale_snapshot_minutes: 0,
};

function emitMetric(
  metric: FrontendTelemetryMetric,
  value: number,
  tags?: Record<string, string | number | boolean>,
): void {
  metricRegistry[metric] = value;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("collectiq-frontend-metric", {
        detail: { metric, value, tags: tags ?? {} },
      }),
    );
  }
}

export function recordProjectionLagMs(lagMs: number, envelope?: string): void {
  const safe = Math.max(0, Math.floor(lagMs));
  emitMetric("frontend_projection_lag_ms", safe, envelope ? { envelope } : undefined);
}

export function recordSseReconnect(tenantId?: string): void {
  emitMetric("frontend_sse_reconnect_total", metricRegistry.frontend_sse_reconnect_total + 1, {
    tenantId: tenantId ?? "unknown",
  });
}

export function recordSseDrop(reason: string): void {
  emitMetric("frontend_sse_drop_total", metricRegistry.frontend_sse_drop_total + 1, { reason });
}

export function recordPollingFallbackActivated(route: string): void {
  emitMetric(
    "frontend_polling_fallback_activated_total",
    metricRegistry.frontend_polling_fallback_activated_total + 1,
    { route },
  );
}

export function recordStaleSnapshotMinutes(minutes: number): void {
  emitMetric("frontend_stale_snapshot_minutes", Math.max(0, Math.floor(minutes)));
}

export function getFrontendTelemetrySnapshot(): Record<FrontendTelemetryMetric, number> {
  return { ...metricRegistry };
}
