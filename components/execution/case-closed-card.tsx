"use client";

import { useMemo } from "react";
import type { ExecutionTrace } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labelState } from "@/lib/state-copy";

function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function centsLabel(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

export function CaseClosedCard({ trace }: { trace?: ExecutionTrace | null }) {
  const summary = useMemo(() => {
    const transitions = trace?.transitions ?? [];
    let originalCents: number | null = null;
    let negotiatedCents: number | null = null;
    let paymentState = "NOT_STARTED";
    const labels: string[] = [];
    for (const t of transitions) {
      if (t.machine === "DATA") {
        const m = parseMeta(t.metadataJson);
        const v = m?.originalBalanceCents ?? m?.amountCents ?? m?.balanceCents;
        if (typeof v === "number" && Number.isFinite(v)) {
          originalCents = v;
        }
      }
      if (t.machine === "CALL") {
        const m = parseMeta(t.metadataJson);
        const v = m?.negotiatedAmountCents ?? m?.offerAmountCents;
        if (typeof v === "number" && Number.isFinite(v)) {
          negotiatedCents = v;
        }
      }
      if (t.machine === "PAYMENT") {
        paymentState = t.to;
      }
      if (t.machine === "ACCOUNT" && t.to === "CLOSED") {
        labels.push("Account closed");
      }
      if (t.machine === "SYNC" && t.to === "COMPLETED") {
        labels.push("Sync completed");
      }
    }
    return { originalCents, negotiatedCents, paymentState, labels };
  }, [trace]);

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Case closed</CardTitle>
        <Badge variant="secondary" className="font-mono text-xs">
          CASE_CLOSED
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Original amount</div>
            <div className="font-medium tabular-nums">{centsLabel(summary.originalCents)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Negotiated amount</div>
            <div className="font-medium tabular-nums">{centsLabel(summary.negotiatedCents)}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Payment status</div>
          <div className="font-medium">{labelState(summary.paymentState)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Timeline summary</div>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {(summary.labels.length ? summary.labels : ["Lifecycle complete"]).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
