"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchExecutionRetries } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";
import { useGlobalEventStream } from "@/lib/event-stream-context";
import { cn } from "@/lib/utils";
import { canUsePollingFallback } from "@/lib/policy/frontend-policy";

export default function RetriesPage() {
  const stream = useGlobalEventStream();
  const pollingFallbackEnabled = canUsePollingFallback(stream, true);
  const refetchInterval = usePollingPolicy({
    mode: "active",
    enabled: pollingFallbackEnabled,
    sseConnected: stream.sseConnected,
    sseFailed: stream.sseFailed,
  });
  const q = useQuery({
    queryKey: ["execution-retries"],
    queryFn: () => fetchExecutionRetries(),
    refetchInterval,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Retry dashboard</h1>
      <p className="text-sm text-muted-foreground">
        Cases with retryable failure signals (open executions with call, payment, or approval timeout states).
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Failed / retryable cases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {q.isError ? (
            <p className="text-sm text-destructive">
              {(q.error as { message?: string })?.message ?? "Failed to load retries."}
            </p>
          ) : null}
          {q.data && q.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No retryable failures for this tenant.</p>
          ) : null}
          {q.data?.map((row) => (
            <div
              key={row.correlationId}
              className="flex flex-col gap-2 rounded-md border p-3 text-sm md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="font-mono text-xs text-muted-foreground">{row.correlationId}</div>
                <div className="font-medium">{row.lastState}</div>
                <div className="text-xs text-muted-foreground">Reason: {row.failureReason}</div>
                <div className="text-xs text-muted-foreground">Retries observed: {row.retryCount}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/execution/${encodeURIComponent(row.correlationId)}`} className={cn(buttonVariants())}>
                  Open case
                </Link>
                <Button type="button" variant="secondary" onClick={() => q.refetch()}>
                  Refresh row
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
