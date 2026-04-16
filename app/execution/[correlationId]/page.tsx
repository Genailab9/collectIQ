"use client";

import { useQuery } from "@tanstack/react-query";
import { ExecutionSummary } from "@/components/execution/execution-summary";
import { NegotiationInsightsCard } from "@/components/execution/negotiation-insights-card";
import { AgentAssistPanel } from "@/components/execution/agent-assist-panel";
import { NextBestAction } from "@/components/execution/next-best-action";
import { CaseClosedCard } from "@/components/execution/case-closed-card";
import { ExecutionJourneyTimeline, deriveJourneyState } from "@/components/execution/timeline";
import { TimelinePanel } from "@/components/timeline/timeline-panel";
import { getExecutionTrace } from "@/lib/api-client";
import { labelState } from "@/lib/state-copy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";
import { useGlobalEventStream } from "@/lib/event-stream-context";
import { canUsePollingFallback } from "@/lib/policy/frontend-policy";
import { useExecutionStore } from "@/lib/use-execution-store";

export default function ExecutionDetailPage({
  params,
}: {
  params: { correlationId: string };
}) {
  const correlationId = decodeURIComponent(params.correlationId);
  const executionSnapshot = useExecutionStore();
  const executionCase = executionSnapshot.byCorrelationId[correlationId];
  const stream = useGlobalEventStream();
  const pollingFallbackEnabled = canUsePollingFallback(stream, true);
  const refetchInterval = usePollingPolicy({
    mode: "active",
    enabled: pollingFallbackEnabled,
    sseConnected: stream.sseConnected,
    sseFailed: stream.sseFailed,
  });
  const traceQuery = useQuery({
    queryKey: ["case-trace", correlationId],
    queryFn: () => getExecutionTrace(correlationId),
    refetchInterval,
  });
  const stateByPhase = executionCase?.machineStates ?? {};
  const latestPhase = executionCase?.lastTransitionMachine ?? "DATA";
  const journey = deriveJourneyState(stateByPhase);
  const staleMinutes =
    executionCase?.lastUpdatedAtMs != null
      ? Math.floor((executionSnapshot.lastUpdatedAtMs - executionCase.lastUpdatedAtMs) / 60000)
      : null;
  const isStale = staleMinutes != null && staleMinutes >= 3;

  const journeyFlags: string[] = [];
  if (stateByPhase.CALL === "FAILED") journeyFlags.push("CALL_FAILED");
  if (stateByPhase.APPROVAL === "TIMEOUT") journeyFlags.push("APPROVAL_TIMEOUT");
  if (stateByPhase.PAYMENT === "PROCESSING") journeyFlags.push("PAYMENT_PROCESSING");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Case Timeline View</h1>
      <ExecutionSummary correlationId={correlationId} />
      <div className="grid gap-4 md:grid-cols-2">
        <NegotiationInsightsCard trace={traceQuery.data} />
        <AgentAssistPanel trace={traceQuery.data} />
      </div>
      <NextBestAction
        correlationId={correlationId}
        machineStates={stateByPhase}
        staleMinutes={staleMinutes}
      />
      {journey === "CASE_CLOSED" ? <CaseClosedCard trace={traceQuery.data} /> : null}
      {isStale ? (
        <Card>
          <CardHeader>
            <CardTitle>Stale Execution Detection</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-amber-800 dark:text-amber-200">
            This case has not transitioned for {staleMinutes} minutes. Use retry actions (call or payment) or check
            observability trace for recovery guidance.
          </CardContent>
        </Card>
      ) : null}
      {journeyFlags.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Journey Flags</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {journeyFlags.map((flag) => (
              <span key={flag} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
                {labelState(flag)}
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <ExecutionJourneyTimeline machineStates={stateByPhase} latestPhase={latestPhase} />
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

