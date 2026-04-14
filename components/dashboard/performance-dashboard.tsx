"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDashboardMetrics } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const REFETCH_MS = 30_000;

function formatAvgResolution(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  if (ms >= 86_400_000) {
    return `${(ms / 86_400_000).toFixed(1)} d`;
  }
  if (ms >= 3_600_000) {
    return `${(ms / 3_600_000).toFixed(1)} h`;
  }
  if (ms >= 60_000) {
    return `${Math.round(ms / 60_000)} min`;
  }
  return `${Math.round(ms / 1000)} s`;
}

export function PerformanceDashboard() {
  const metricsQuery = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: () => fetchDashboardMetrics(),
    refetchInterval: REFETCH_MS,
    retry: 1,
  });

  if (metricsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Collections metrics</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          {(metricsQuery.error as { message?: string })?.message ??
            "Could not load metrics. Check tenant context and API access."}
        </CardContent>
      </Card>
    );
  }

  const m = metricsQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Collections metrics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Values are derived from the transition log for the current tenant (refreshes every{" "}
          {REFETCH_MS / 1000}s).
        </p>
        <div className="grid gap-3 md:grid-cols-5">
          <Metric label="Total cases" value={m ? String(m.totalCases) : "…"} />
          <Metric
            label="Collected amount"
            value={m ? `$${(m.collectedAmountCents / 100).toFixed(2)}` : "…"}
          />
          <Metric label="Recovery rate" value={m ? `${m.recoveryRate.toFixed(1)}%` : "…"} />
          <Metric label="Avg resolution time" value={m ? formatAvgResolution(m.avgResolutionTimeMs) : "…"} />
          <Metric label="Approval rate" value={m ? `${m.approvalRate.toFixed(1)}%` : "…"} />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
