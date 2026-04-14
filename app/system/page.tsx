"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function fetchHealth() {
  const res = await fetch("/api/saas/admin/health", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || "Failed to load system health.");
  }
  return res.json() as Promise<{
    recoveryWorkerEnabled: boolean;
    webhookRecoveryEnabled: boolean;
    featureFlags: Record<string, boolean>;
    circuits: Array<{ circuitKey: string; consecutiveFailures: number; circuitOpenUntilIso: string | null }>;
    metricsSample: string;
  }>;
}

export default function SystemHealthPage() {
  const q = useQuery({ queryKey: ["system-health"], queryFn: fetchHealth, retry: 1 });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">System Health</h1>
      <p className="text-sm text-muted-foreground">
        Admin-only view of recovery flags, webhook sweeps, feature toggles, circuit diagnostics, and a short Prometheus
        sample.
      </p>
      {q.isLoading ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Loading health snapshot…</CardContent>
        </Card>
      ) : null}
      {q.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(q.error as Error).message}
          </CardContent>
        </Card>
      ) : null}
      {q.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recovery & webhooks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>Recovery worker: {q.data.recoveryWorkerEnabled ? "enabled" : "disabled"}</div>
              <div>Webhook recovery: {q.data.webhookRecoveryEnabled ? "enabled" : "disabled"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Feature flags</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(q.data.featureFlags, null, 2)}
              </pre>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Circuit breaker states</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(q.data.circuits, null, 2)}
              </pre>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Metrics sample</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{q.data.metricsSample}</pre>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
