"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchActiveExecutions,
  fetchObservabilitySummary,
  fetchStructuredLogExport,
  getStoredTenantId,
  setApiTenantId,
} from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";
import { useGlobalEventStream } from "@/lib/event-stream-context";
import { canUsePollingFallback } from "@/lib/policy/frontend-policy";

type StreamFilter = "ALL" | "CAMPAIGN" | "CALL" | "PAYMENT";

function classifyEvent(ev: { phase?: string; adapter?: string; result?: string; message?: string }): StreamFilter {
  const phase = (ev.phase ?? "").toUpperCase();
  const adapter = (ev.adapter ?? "").toUpperCase();
  const result = (ev.result ?? "").toUpperCase();
  const message = (ev.message ?? "").toUpperCase();
  if (phase.includes("PAY") || adapter.includes("PAYMENT") || result.includes("PAYMENT")) return "PAYMENT";
  if (phase.includes("CALL") || phase.includes("NEGOTIATE") || adapter.includes("CALL")) return "CALL";
  if (phase.includes("DATA") || message.includes("CAMPAIGN") || adapter.includes("INGEST")) return "CAMPAIGN";
  return "ALL";
}

function retrySuggestion(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("compliance")) return "Check compliance window and tenant policy settings before retry.";
  if (t.includes("idempotency")) return "Reuse the same action screen and refresh state before re-submitting.";
  if (t.includes("payment")) return "Retry payment confirmation from Payments queue with the latest payment ID.";
  if (t.includes("call")) return "Retry call progression from Live Calls or execution detail actions.";
  return "Open case trace and retry the latest failed action.";
}

export default function ObservabilityPage() {
  const [tenantInput, setTenantInput] = useState(getStoredTenantId() ?? "");
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("ALL");
  const stream = useGlobalEventStream();
  const pollingFallbackEnabled = canUsePollingFallback(stream, true);
  const pollingRefetchInterval = usePollingPolicy({
    mode: "active",
    enabled: pollingFallbackEnabled,
    sseConnected: stream.sseConnected,
    sseFailed: stream.sseFailed,
  });

  const summaryQuery = useQuery({
    queryKey: ["observability-summary"],
    queryFn: () => fetchObservabilitySummary(),
    refetchInterval: pollingRefetchInterval,
    retry: 1,
  });
  const streamQuery = useQuery({
    queryKey: ["observability-stream", 80],
    queryFn: () => fetchStructuredLogExport(80),
    refetchInterval: pollingRefetchInterval,
    retry: 1,
  });
  const activeExecutions = useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
    retry: 1,
  });

  const streamRows = useMemo(() => {
    const rows = streamQuery.data ?? [];
    if (streamFilter === "ALL") return rows;
    return rows.filter((ev) => classifyEvent(ev) === streamFilter);
  }, [streamFilter, streamQuery.data]);
  const streamReferenceTime = streamQuery.dataUpdatedAt;

  const groupedIssues = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const ev of streamQuery.data ?? []) {
      const text = `${ev.result ?? ""} ${ev.message ?? ""}`.trim();
      if (!/error|failed|blocked/i.test(text)) continue;
      const key = text || "Unknown runtime issue";
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [streamQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Observability</h1>
          <p className="text-sm text-muted-foreground">
            Live execution visibility with trace lookup, stream filters, and retry guidance.
          </p>
        </div>
        <Link href="/observability/sample-correlation-id" className={cn(buttonVariants({ variant: "secondary" }))}>
          Open trace viewer
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Isolation Filter</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tenant ID</label>
            <input
              value={tenantInput}
              onChange={(e) => setTenantInput(e.target.value)}
              className="h-10 w-72 rounded-md border bg-background px-3 text-sm"
              placeholder="demo-tenant"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                await setApiTenantId(tenantInput.trim());
                void summaryQuery.refetch();
                void streamQuery.refetch();
                void activeExecutions.refetch();
              })();
            }}
            disabled={!tenantInput.trim()}
          >
            Apply Tenant
          </Button>
          <p className="text-xs text-muted-foreground">
            Current stored tenant: <span className="font-mono">{getStoredTenantId() ?? "n/a"}</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Adapter Errors</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summaryQuery.data?.adapterErrors ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retry Observations</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summaryQuery.data?.adapterRetryObservations ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stuck Executions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summaryQuery.data?.stuckExecutions.length ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Cases</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{activeExecutions.data?.length ?? 0}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Live Event Stream</CardTitle>
          <div className="flex flex-wrap gap-2">
            {(["ALL", "CAMPAIGN", "CALL", "PAYMENT"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={streamFilter === f ? "default" : "secondary"}
                onClick={() => setStreamFilter(f)}
              >
                {f}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {(streamRows ?? []).slice(0, 40).map((ev, idx) => (
            <div key={`${ev.timestamp ?? ev.at ?? idx}-${idx}`} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{ev.result ?? "EVENT"}</Badge>
                  <Badge variant="outline">{classifyEvent(ev)}</Badge>
                  {ev.correlationId ? (
                    <Link href={`/observability/${encodeURIComponent(ev.correlationId)}`} className="font-mono text-xs underline">
                      {ev.correlationId}
                    </Link>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.timestamp ?? ev.at ?? streamReferenceTime).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{ev.message ?? `${ev.adapter ?? "system"} ${ev.phase ?? ""}`}</p>
            </div>
          ))}
          {streamRows.length === 0 ? <p className="text-sm text-muted-foreground">No stream events for this filter.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Error Insights & Retry Guidance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {groupedIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No grouped runtime issues in the current event window.</p>
          ) : (
            groupedIssues.map(([message, count]) => (
              <div key={message} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{message}</p>
                  <Badge variant="secondary">{count}x</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{retrySuggestion(message)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

