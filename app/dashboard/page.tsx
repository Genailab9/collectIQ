"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExecutionSummaryCard } from "@/components/execution/execution-summary-card";
import { MachineStateCard } from "@/components/execution/machine-state-card";
import { ActionPanel } from "@/components/execution/action-panel";
import { PerformanceDashboard } from "@/components/dashboard/performance-dashboard";
import { SystemActivityFeed } from "@/components/system/system-activity-feed";
import { TimelinePanel } from "@/components/timeline/timeline-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getExecutionTrace } from "@/lib/api-client";

const MACHINES = ["CALL", "APPROVAL", "PAYMENT", "SYNC"] as const;

export default function DashboardPage() {
  const [inputCorrelationId, setInputCorrelationId] = useState("");
  const [activeCorrelationId, setActiveCorrelationId] = useState("");

  const traceQuery = useQuery({
    queryKey: ["execution-trace", activeCorrelationId],
    queryFn: () => getExecutionTrace(activeCorrelationId),
    enabled: activeCorrelationId.trim().length > 0,
    refetchInterval: 5000,
  });

  const machineStates = useMemo(() => {
    const latest: Record<(typeof MACHINES)[number], string> = {
      CALL: "NOT_STARTED",
      APPROVAL: "NOT_STARTED",
      PAYMENT: "NOT_STARTED",
      SYNC: "NOT_STARTED",
    };
    for (const t of traceQuery.data?.transitions ?? []) {
      if (t.machine in latest) {
        latest[t.machine as keyof typeof latest] = t.to;
      }
    }
    return latest;
  }, [traceQuery.data]);

  const progress = useMemo(() => {
    const completed = MACHINES.filter(
      (m) => machineStates[m] !== "NOT_STARTED" && machineStates[m] !== "ALTERNATE_METHOD",
    ).length;
    return (completed / MACHINES.length) * 100;
  }, [machineStates]);

  const lastUpdated =
    traceQuery.data?.transitions[traceQuery.data.transitions.length - 1]?.occurredAt ?? null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Live Execution Dashboard</h1>
      <PerformanceDashboard />
      <Card>
        <CardHeader>
          <CardTitle>Trace Lookup</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <input
            value={inputCorrelationId}
            onChange={(e) => setInputCorrelationId(e.target.value)}
            placeholder="Enter correlationId"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
          <Button
            onClick={() => setActiveCorrelationId(inputCorrelationId.trim())}
            disabled={!inputCorrelationId.trim()}
          >
            Load
          </Button>
                  {activeCorrelationId ? (
                    <Link href={`/execution/${encodeURIComponent(activeCorrelationId)}`}>
                      <Button variant="secondary">Open Case Timeline</Button>
                    </Link>
                  ) : null}
        </CardContent>
      </Card>

      {activeCorrelationId ? (
        <>
          <ExecutionSummaryCard
            correlationId={activeCorrelationId}
            progressPercent={progress}
            transitionCount={traceQuery.data?.transitions.length ?? 0}
            errorCount={traceQuery.data?.errors.length ?? 0}
            lastUpdatedAt={lastUpdated}
          />

          {traceQuery.isError ? (
            <Card>
              <CardContent className="py-4 text-sm text-destructive">
                {(traceQuery.error as { message?: string })?.message ||
                  "Failed to load execution trace. Ensure tenant is configured."}
                <div className="mt-2">
                  <Button size="sm" variant="secondary" onClick={() => traceQuery.refetch()}>
                    Retry Load
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {traceQuery.isLoading ? (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                Loading execution trace...
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {MACHINES.map((machine) => (
              <MachineStateCard key={machine} machine={machine} state={machineStates[machine]} />
            ))}
          </div>
          <ActionPanel correlationId={activeCorrelationId} machineStates={machineStates} />
          <TimelinePanel trace={traceQuery.data} />
        </>
      ) : null}
      <SystemActivityFeed />
    </div>
  );
}

