"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCollectiqFeatureFlags, getExecutionTrace } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";
import { useGlobalEventStream } from "@/lib/event-stream-context";
import { canUseFullTraceMode, canUsePollingFallback } from "@/lib/policy/frontend-policy";
import { useAuthUser } from "@/lib/use-auth-user";

type EventType = "ALL" | "TRANSITION" | "ADAPTER" | "COMPLIANCE" | "ERROR";

type DebugEvent = {
  id: string;
  at: string;
  machine: string;
  type: EventType;
  title: string;
  details: string;
};

function inferMachineFromPhase(phase: string): string {
  if (phase === "AUTH" || phase === "NEGOTIATE") {
    return "CALL";
  }
  if (phase === "APPROVAL") {
    return "APPROVAL";
  }
  if (phase === "PAY") {
    return "PAYMENT";
  }
  if (phase === "SYNC") {
    return "SYNC";
  }
  if (phase === "DATA") {
    return "DATA";
  }
  return "UNKNOWN";
}

function eventTone(type: EventType): string {
  if (type === "ERROR") return "border-red-500/40 bg-red-500/10";
  if (type === "COMPLIANCE") return "border-amber-500/40 bg-amber-500/10";
  if (type === "TRANSITION") return "border-emerald-500/40 bg-emerald-500/10";
  return "border-border bg-background";
}

function retrySuggestion(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("compliance")) return "Review compliance policy windows and retry from approved path.";
  if (t.includes("idempotency")) return "Refresh state and avoid duplicate submissions with new idempotency keys.";
  if (t.includes("payment")) return "Retry payment confirmation from Payments queue with current payment ID.";
  if (t.includes("call")) return "Retry call progression from Live Calls or execution action panel.";
  return "Retry from the latest valid stage and inspect observability details.";
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "n/a";
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

export default function TraceViewerPage({
  params,
}: {
  params: { correlationId: string };
}) {
  const correlationId = decodeURIComponent(params.correlationId);
  const [machineFilter, setMachineFilter] = useState("ALL");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType>("ALL");
  const [traceMode, setTraceMode] = useState<"summary" | "full">("summary");
  const auth = useAuthUser();
  const flagsQuery = useQuery({
    queryKey: ["feature-flags", "trace-policy"],
    queryFn: () => fetchCollectiqFeatureFlags(),
    retry: 1,
  });
  const stream = useGlobalEventStream();
  const pollingFallbackEnabled = canUsePollingFallback(stream, true);
  const traceRefetchInterval = usePollingPolicy({
    mode: "active",
    enabled: pollingFallbackEnabled,
    sseConnected: stream.sseConnected,
    sseFailed: stream.sseFailed,
  });
  const canSelectFullTrace = canUseFullTraceMode({
    role: auth.data?.role,
    flags: flagsQuery.data?.flags ?? null,
    debugHeaderPresent: false,
  });
  const effectiveTraceMode = canSelectFullTrace ? traceMode : "summary";

  const traceQuery = useQuery({
    queryKey: ["case-trace", correlationId, effectiveTraceMode],
    queryFn: () => getExecutionTrace(correlationId, { mode: effectiveTraceMode }),
    enabled: correlationId.trim().length > 0,
    refetchInterval: traceRefetchInterval,
  });

  const events = useMemo(() => {
    const trace = traceQuery.data;
    if (!trace) {
      return [] as DebugEvent[];
    }

    const transitionEvents: DebugEvent[] = trace.transitions.map((t, idx) => ({
      id: `t-${idx}-${t.occurredAt}`,
      at: t.occurredAt,
      machine: t.machine,
      type: "TRANSITION",
      title: `${t.machine}: ${t.from} -> ${t.to}`,
      details: `Actor: ${t.actor ?? "n/a"}\nMetadata:\n${stringify(parseJsonObject(t.metadataJson))}`,
    }));

    const adapterEvents: DebugEvent[] = (trace.adapterCalls ?? []).map((a, idx) => {
      const upperKind = a.auditKind.toUpperCase();
      const isCompliance = upperKind.includes("COMPLIANCE");
      const type: EventType = isCompliance ? "COMPLIANCE" : "ADAPTER";
      return {
        id: `a-${idx}-${a.createdAt}`,
        at: a.createdAt,
        machine: inferMachineFromPhase(a.executionPhase),
        type,
        title: `${a.auditKind} (${a.executionPhase})`,
        details: stringify(a.payload),
      };
    });

    const errorEvents: DebugEvent[] = trace.errors.map((e, idx) => ({
      id: `e-${idx}-${e.at}`,
      at: e.at,
      machine: "UNKNOWN",
      type: "ERROR",
      title: `${e.source} error`,
      details: e.detail,
    }));

    return [...transitionEvents, ...adapterEvents, ...errorEvents].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  }, [traceQuery.data]);

  const machineOptions = useMemo(() => {
    const set = new Set<string>(["ALL"]);
    events.forEach((e) => set.add(e.machine));
    return Array.from(set);
  }, [events]);

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        const machineOk = machineFilter === "ALL" || event.machine === machineFilter;
        const typeOk = eventTypeFilter === "ALL" || event.type === eventTypeFilter;
        return machineOk && typeOk;
      }),
    [events, eventTypeFilter, machineFilter],
  );

  const groupedErrors = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      if (event.type !== "ERROR" && event.type !== "COMPLIANCE") continue;
      map.set(event.title, (map.get(event.title) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Trace Viewer</h1>
        <div className="flex items-center gap-3">
          <select
            value={effectiveTraceMode}
            onChange={(e) => setTraceMode(e.target.value as "summary" | "full")}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="summary">Trace Summary</option>
            <option value="full" disabled={!canSelectFullTrace}>
              Trace Full (debug)
            </option>
          </select>
          <Link href="/observability" className="text-sm text-muted-foreground underline">
            Back to observability
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trace: {correlationId}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {!canSelectFullTrace ? (
            <p className="text-xs text-muted-foreground md:col-span-2">
              Full trace mode requires backend policy approval (authorized role, tenant flag, and debug header policy).
            </p>
          ) : null}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Filter by machine</label>
            <select
              value={machineFilter}
              onChange={(e) => setMachineFilter(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {machineOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Filter by event type</label>
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as EventType)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="ALL">ALL</option>
              <option value="TRANSITION">TRANSITION</option>
              <option value="ADAPTER">ADAPTER</option>
              <option value="COMPLIANCE">COMPLIANCE</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {traceQuery.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(traceQuery.error as { message?: string })?.message ?? "Failed to load trace."}
            <div className="mt-3">
              <button
                className="rounded-md border px-3 py-1 text-sm text-foreground"
                onClick={() => traceQuery.refetch()}
              >
                Retry Load
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {traceQuery.isLoading ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">Loading trace events...</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Debug Events ({filteredEvents.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events match selected filters.</p>
          ) : (
            filteredEvents.map((event) => (
              <div key={event.id} className={`space-y-2 rounded-md border p-3 ${eventTone(event.type)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{event.type}</Badge>
                  <Badge variant="outline">{event.machine}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm font-medium">{event.title}</div>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{event.details}</pre>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Error Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {groupedErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No grouped error/compliance events for this trace.</p>
          ) : (
            groupedErrors.map(([title, count]) => (
              <div key={title} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{title}</p>
                  <Badge variant="secondary">{count}x</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{retrySuggestion(title)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

