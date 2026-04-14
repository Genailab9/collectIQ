"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createBillingCheckoutSession, getBillingSummary } from "@/lib/api-client";
export default function BillingPage() {
  const summary = useQuery({ queryKey: ["billing-summary"], queryFn: () => getBillingSummary() });
  const [busy, setBusy] = useState<null | "pro" | "enterprise">(null);

  const startCheckout = async (plan: "pro" | "enterprise") => {
    setBusy(plan);
    try {
      const { url } = await createBillingCheckoutSession(plan);
      if (url) {
        window.location.href = url;
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Billing & Plans</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {(["free", "pro", "enterprise"] as const).map((plan) => (
          <Card key={plan}>
            <CardHeader>
              <CardTitle className="capitalize">{plan}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {plan === "free" ? <p>Core execution limits for evaluation.</p> : null}
              {plan === "pro" ? <p>Team rollout with higher limits.</p> : null}
              {plan === "enterprise" ? <p>Unmetered-style limits and priority support.</p> : null}
              {plan !== "free" ? (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => startCheckout(plan)}
                >
                  {busy === plan ? "Redirecting…" : "Subscribe via Stripe"}
                </Button>
              ) : (
                <p className="text-xs">Default plan — upgrade when ready.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Current usage</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {summary.isLoading ? <p>Loading…</p> : null}
          {summary.data ? (
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="text-muted-foreground">Plan</div>
                <div className="font-medium">{summary.data.plan}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Limits</div>
                <div>
                  cases {summary.data.limits.cases ?? "∞"} · API {summary.data.limits.apiCalls ?? "∞"} · payments{" "}
                  {summary.data.limits.payments ?? "∞"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Recorded usage</div>
                <div>
                  {summary.data.usage.cases} cases · {summary.data.usage.apiCalls} API calls ·{" "}
                  {summary.data.usage.paymentsProcessed} payments
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
