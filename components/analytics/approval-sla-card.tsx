"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApprovalSlaMetrics } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton-card";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 1000)} s`;
}

export function ApprovalSlaCard() {
  const refetchInterval = usePollingPolicy({ mode: "normal" });
  const q = useQuery({
    queryKey: ["approval-sla-metrics"],
    queryFn: () => fetchApprovalSlaMetrics(),
    refetchInterval,
    retry: 1,
  });

  if (q.isLoading) {
    return <SkeletonCard />;
  }
  if (q.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Approval SLA</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">
          {(q.error as { message?: string })?.message ?? "Could not load approval analytics."}
        </CardContent>
      </Card>
    );
  }

  const m = q.data!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval SLA</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Avg approval time</div>
          <div className="font-medium tabular-nums">{formatDuration(m.avgApprovalTimeMs)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Timeout rate</div>
          <div className="font-medium tabular-nums">{(m.timeoutRate * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Pending count</div>
          <div className="font-medium tabular-nums">{m.pendingCount}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Breached SLA (timeout / escalated)</div>
          <div className="font-medium tabular-nums">{m.breachedSlaCount}</div>
        </div>
      </CardContent>
    </Card>
  );
}
