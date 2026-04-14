"use client";

import { useMemo } from "react";
import type { ExecutionTrace } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function parseMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function AgentAssistPanel({ trace }: { trace?: ExecutionTrace | null }) {
  const data = useMemo(() => {
    const transitions = trace?.transitions ?? [];
    const callRows = transitions.filter((t) => t.machine === "CALL");
    const latestMeta = parseMetadata(callRows[callRows.length - 1]?.metadataJson ?? null);
    const borrowerProfile =
      (latestMeta.borrowerProfile as string | undefined) ??
      (latestMeta.borrowerName as string | undefined) ??
      "Borrower profile unavailable";
    const script =
      (latestMeta.recommendedScript as string | undefined) ??
      "Confirm identity, explain balance, propose payment options, and capture objections.";
    const nextBestAction =
      (latestMeta.nextBestAction as string | undefined) ??
      (callRows[callRows.length - 1]?.to === "CONNECTED"
        ? "Authenticate borrower"
        : callRows[callRows.length - 1]?.to === "AUTHENTICATED"
          ? "Proceed with negotiation"
          : "Review latest transition and continue execution");
    return { borrowerProfile, script, nextBestAction };
  }, [trace]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Assist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div><span className="text-muted-foreground">Borrower profile: </span>{data.borrowerProfile}</div>
        <div><span className="text-muted-foreground">Recommended script: </span>{data.script}</div>
        <div><span className="text-muted-foreground">Next best action: </span>{data.nextBestAction}</div>
      </CardContent>
    </Card>
  );
}

