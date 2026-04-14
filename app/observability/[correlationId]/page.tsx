"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getExecutionTrace } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const traceQuery = useQuery({
    queryKey: ["observability-trace", correlationId],
    queryFn: () => getExecutionTrace(correlationId),
    enabled: correlationId.trim().length > 0,
    refetchInterval: 5000,
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

    const adapterEvents: DebugEvent[] = trace.adapterCalls.map((a, idx) => {
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Trace Viewer</h1>
        <Link href="/observability" className="text-sm text-muted-foreground underline">
          Back to observability
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trace: {correlationId}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
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
              <div key={event.id} className="space-y-2 rounded-md border p-3">
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
    </div>
  );
}

