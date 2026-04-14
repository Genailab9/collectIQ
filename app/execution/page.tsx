"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchActiveExecutions } from "@/lib/api-client";
import { labelState } from "@/lib/state-copy";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const POLL_MS = 8000;

export default function ExecutionListPage() {
  const activeQuery = useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
    refetchInterval: POLL_MS,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Active executions</h1>
          <p className="text-sm text-muted-foreground">
            From <span className="font-mono">GET /execution/active</span> — excludes cases whose latest SYNC state is
            COMPLETED. Refreshes every {POLL_MS / 1000}s.
          </p>
        </div>
        <Button variant="secondary" disabled={activeQuery.isFetching} onClick={() => activeQuery.refetch()}>
          Refresh now
        </Button>
      </div>

      {activeQuery.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(activeQuery.error as { message?: string })?.message ?? "Failed to load active executions."}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cases</CardTitle>
        </CardHeader>
        <CardContent>
          {activeQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : null}
          {!activeQuery.isLoading && (activeQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No active cases.</p>
          ) : null}
          {(activeQuery.data?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Correlation</th>
                    <th className="py-2 pr-4">Phase</th>
                    <th className="py-2 pr-4">State summary</th>
                    <th className="py-2 pr-4">Updated</th>
                    <th className="py-2 pr-4">Campaign</th>
                    <th className="py-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {(activeQuery.data ?? []).map((row) => (
                    <tr key={row.correlationId} className="border-t">
                      <td className="py-2 pr-4 font-mono text-xs">{row.correlationId}</td>
                      <td className="py-2 pr-4">{row.currentPhase}</td>
                      <td className="max-w-md truncate py-2 pr-4 font-mono text-xs" title={row.currentStateSummary}>
                        {labelState(row.currentStateSummary)}
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(row.lastUpdatedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{row.campaignId ?? "—"}</td>
                      <td className="py-2">
                        <Link
                          href={`/execution/${encodeURIComponent(row.correlationId)}`}
                          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                        >
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
