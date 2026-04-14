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

export function NegotiationInsightsCard({ trace }: { trace?: ExecutionTrace | null }) {
  const content = useMemo(() => {
    const callTransitions = (trace?.transitions ?? []).filter((t) => t.machine === "CALL");
    const metas = callTransitions.map((t) => parseMetadata(t.metadataJson));
    const suggested =
      metas.find((m) => typeof m.aiSuggestedOfferCents === "number")?.aiSuggestedOfferCents ??
      metas.find((m) => typeof m.suggestedAmountCents === "number")?.suggestedAmountCents ??
      "n/a";
    const finalAmount =
      metas.find((m) => typeof m.finalNegotiatedAmountCents === "number")?.finalNegotiatedAmountCents ??
      metas.find((m) => typeof m.negotiatedAmountCents === "number")?.negotiatedAmountCents ??
      "n/a";
    const why =
      (metas.find((m) => typeof m.offerExplanation === "string")?.offerExplanation as string | undefined) ??
      "Offer aligns with account balance, overdue age, and repayment likelihood based on previous behavior.";
    return { suggested, finalAmount, why };
  }, [trace]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Negotiation Insights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div><span className="text-muted-foreground">AI suggested offer: </span>{String(content.suggested)}</div>
        <div><span className="text-muted-foreground">Final negotiated amount: </span>{String(content.finalAmount)}</div>
        <div><span className="text-muted-foreground">Why this offer? </span>{content.why}</div>
      </CardContent>
    </Card>
  );
}

