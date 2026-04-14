"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExecutionSummary } from "@/components/execution/execution-summary";
import { NegotiationInsightsCard } from "@/components/execution/negotiation-insights-card";
import { AgentAssistPanel } from "@/components/execution/agent-assist-panel";
import { NextBestAction } from "@/components/execution/next-best-action";
import { TimelinePanel } from "@/components/timeline/timeline-panel";
import { getExecutionTrace } from "@/lib/api-client";
import { labelState } from "@/lib/state-copy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PHASES = ["DATA", "CALL", "APPROVAL", "PAYMENT", "SYNC"] as const;

export default function ExecutionDetailPage({
  params,
}: {
  params: { correlationId: string };
}) {
  const correlationId = decodeURIComponent(params.correlationId);
  const traceQuery = useQuery({
    queryKey: ["case-trace", correlationId],
    queryFn: () => getExecutionTrace(correlationId),
    refetchInterval: 5000,
  });
  const stateByPhase = useMemo(() => {
    const states: Record<string, string> = {};
    for (const t of traceQuery.data?.transitions ?? []) {
      states[t.machine] = t.to;
    }
    return states;
  }, [traceQuery.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Case Timeline View</h1>
      <ExecutionSummary correlationId={correlationId} />
      <div className="grid gap-4 md:grid-cols-2">
        <NegotiationInsightsCard trace={traceQuery.data} />
        <AgentAssistPanel trace={traceQuery.data} />
      </div>
      <NextBestAction correlationId={correlationId} machineStates={stateByPhase} />
      <Card>
        <CardHeader>
          <CardTitle>Current State</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-5">
          {PHASES.map((phase) => (
            <div key={phase} className="rounded-md border p-2 text-sm">
              <div className="text-xs text-muted-foreground">{phase}</div>
              <div className="font-medium">{labelState(stateByPhase[phase] ?? "NOT_STARTED")}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      {traceQuery.data?.errors?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Errors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {traceQuery.data.errors.map((e, idx) => (
              <div key={`${e.at}-${idx}`} className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm">
                <div className="font-medium">{e.source}</div>
                <div className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</div>
                <div>{e.detail}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {traceQuery.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(traceQuery.error as { message?: string })?.message ?? "Failed to load case trace."}
          </CardContent>
        </Card>
      ) : null}
      <TimelinePanel trace={traceQuery.data} />
    </div>
  );
}

