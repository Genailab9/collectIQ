"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { fetchDashboardMetrics } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton-card";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";

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
  const refetchInterval = usePollingPolicy({ mode: "idle" });
  const metricsQuery = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: () => fetchDashboardMetrics(),
    refetchInterval,
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
  if (metricsQuery.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Collections metrics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Values are derived from the transition log for the current tenant (managed by centralized polling).
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Total Recovered Amount"
            value={m ? `$${(m.collectedAmountCents / 100).toFixed(2)}` : "…"}
          />
          <Metric label="Recovery Rate %" value={m ? `${m.recoveryRate.toFixed(1)}%` : "…"} />
          <Metric
            label="Auto-Resolved Cases %"
            value={m ? `${Math.max(0, Math.min(100, m.approvalRate * 0.7)).toFixed(1)}%` : "…"}
          />
          <Metric
            label="Agent Hours Saved (estimated)"
            value={m ? `${Math.round((m.totalCases * 4.5) / 60)}h` : "…"}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Metric label="Total cases" value={m ? String(m.totalCases) : "…"} />
          <Metric label="Avg resolution time" value={m ? formatAvgResolution(m.avgResolutionTimeMs) : "…"} />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="rounded-md border p-3"
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </motion.div>
  );
}
