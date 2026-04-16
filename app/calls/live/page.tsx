"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchActiveExecutions } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CallsLivePage() {
  const activeQuery = useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
    retry: 1,
  });

  const callCases = useMemo(
    () =>
      (activeQuery.data ?? []).filter(
        (x) =>
          x.currentPhase === "CALL" ||
          x.currentStateSummary.includes("CALL:RINGING") ||
          x.currentStateSummary.includes("CALL:CONNECTED") ||
          x.currentStateSummary.includes("CALL:NEGOTIATING") ||
          x.currentStateSummary.includes("CALL:WAITING_APPROVAL"),
      ),
    [activeQuery.data],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Live calls</h1>
        <p className="text-sm text-muted-foreground">
          Live call operations from active execution stream (shared domain polling).
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active call cases</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{callCases.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ringing</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {callCases.filter((x) => x.currentStateSummary.includes("CALL:RINGING")).length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected / Negotiating</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {
              callCases.filter(
                (x) =>
                  x.currentStateSummary.includes("CALL:CONNECTED") ||
                  x.currentStateSummary.includes("CALL:NEGOTIATING"),
              ).length
            }
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Call state monitor</CardTitle>
        </CardHeader>
        <CardContent>
          {activeQuery.isLoading ? <SkeletonTable rows={5} /> : null}
          {!activeQuery.isLoading && callCases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No live call-state cases right now.</p>
          ) : null}
          <div className="space-y-2">
            {callCases.map((row) => (
              <div key={row.correlationId} className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-1">
                  <p className="font-mono text-xs">{row.correlationId}</p>
                  <p className="text-sm">{row.currentStateSummary}</p>
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(row.lastUpdatedAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/execution/${encodeURIComponent(row.correlationId)}`}
                    className={cn(buttonVariants({ size: "sm" }))}
                  >
                    Open actions
                  </Link>
                  <Link
                    href={`/observability/${encodeURIComponent(row.correlationId)}`}
                    className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                  >
                    Trace
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

