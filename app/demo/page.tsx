"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  fetchActiveExecutions,
  fetchCollectiqFeatureFlags,
  fetchHealth,
  fetchPendingApprovals,
  fetchPendingPayments,
  postDemoReset,
  postDemoSeed,
} from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { cn } from "@/lib/utils";

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

export default function DemoPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const health = useQuery({ queryKey: ["health"], queryFn: () => fetchHealth(), retry: 1 });
  const flags = useQuery({ queryKey: ["feature-flags"], queryFn: () => fetchCollectiqFeatureFlags() });
  const approvals = useQuery({ queryKey: ["approvals-pending"], queryFn: () => fetchPendingApprovals() });
  const payments = useQuery({ queryKey: ["payments-pending"], queryFn: () => fetchPendingPayments() });
  const active = useQuery({ queryKey: ["execution-active"], queryFn: () => fetchActiveExecutions() });

  const seed = useMutation({
    mutationFn: () => postDemoSeed(),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["approvals-pending"] }),
        queryClient.invalidateQueries({ queryKey: ["payments-pending"] }),
        queryClient.invalidateQueries({ queryKey: ["execution-active"] }),
      ]);
      showToast({
        title: "Demo data seeded",
        description: `Campaign ${res.campaignId.slice(0, 8)}... with ${res.approvalCorrelationIds.length} cases.`,
        variant: "success",
      });
    },
    onError: (e) =>
      showToast({
        title: "Seed failed",
        description: (e as { message?: string })?.message ?? "Could not seed demo data.",
        variant: "error",
      }),
  });

  const reset = useMutation({
    mutationFn: () => postDemoReset(),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["approvals-pending"] }),
        queryClient.invalidateQueries({ queryKey: ["payments-pending"] }),
        queryClient.invalidateQueries({ queryKey: ["execution-active"] }),
      ]);
      showToast({
        title: "Demo reset complete",
        description: `Removed ${res.deletedCorrelationIds} correlation scopes.`,
        variant: "success",
      });
    },
    onError: (e) =>
      showToast({
        title: "Reset failed",
        description: (e as { message?: string })?.message ?? "Could not reset demo data.",
        variant: "error",
      }),
  });

  const demoOn = asBool(flags.data?.flags?.DEMO_MODE);
  const simOn = asBool(flags.data?.flags?.SIMULATE_CALLS);
  const forcePayOn = asBool(flags.data?.flags?.FORCE_PAYMENT_SUCCESS);
  const canRunDemo = demoOn && simOn && forcePayOn;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Demo Control Cockpit</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">10-Minute Demo Flow</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
            <li>Seed demo data</li>
            <li>Open dashboard and show activity stream</li>
            <li>Approve one pending case</li>
            <li>Confirm one payment</li>
            <li>Open case timeline for full trace</li>
            <li>Reset demo data</li>
          </ol>
          <div className="flex flex-wrap items-start gap-2">
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>
              Open Dashboard
            </Link>
            <Link href="/approvals" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              Open Approvals
            </Link>
            <Link href="/payments" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              Open Payments
            </Link>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-base">System Health</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {health.isLoading ? <div className="h-8 animate-pulse rounded bg-muted/50" /> : null}
            {health.isError ? <p className="text-destructive">Health check failed</p> : null}
            {health.data ? (
              <>
                <p>Status: <Badge variant="default">{health.data.status}</Badge></p>
                <p>DB: {health.data.db}</p>
                <p>Uptime: {health.data.uptime}s</p>
                <p className="text-muted-foreground">Version {health.data.version}</p>
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Flags</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>DEMO_MODE: <Badge variant={demoOn ? "default" : "secondary"}>{demoOn ? "ON" : "OFF"}</Badge></p>
            <p>SIMULATE_CALLS: <Badge variant={simOn ? "default" : "secondary"}>{simOn ? "ON" : "OFF"}</Badge></p>
            <p>FORCE_PAYMENT_SUCCESS: <Badge variant={forcePayOn ? "default" : "secondary"}>{forcePayOn ? "ON" : "OFF"}</Badge></p>
          </CardContent>
        </Card>
        <CounterCard title="Pending Approvals" count={approvals.data?.length} loading={approvals.isLoading} error={approvals.isError} />
        <CounterCard title="Pending Payments" count={payments.data?.length} loading={payments.isLoading} error={payments.isError} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CounterCard title="Active Executions" count={active.data?.length} loading={active.isLoading} error={active.isError} />
        <Card>
          <CardHeader><CardTitle className="text-base">Demo Actions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className={`text-xs ${canRunDemo ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
              {canRunDemo
                ? "Ready: demo-safe simulation flags are enabled."
                : "Enable DEMO_MODE + SIMULATE_CALLS + FORCE_PAYMENT_SUCCESS before seeding."}
            </p>
            <div className="flex flex-wrap gap-2">
            <Button disabled={seed.isPending || reset.isPending || !canRunDemo} onClick={() => seed.mutate()}>
              {seed.isPending ? "Seeding..." : "Seed Demo Data"}
            </Button>
            <Button variant="secondary" disabled={seed.isPending || reset.isPending} onClick={() => reset.mutate()}>
              {reset.isPending ? "Resetting..." : "Reset Demo"}
            </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CounterCard({
  title,
  count,
  loading,
  error,
}: {
  title: string;
  count?: number;
  loading: boolean;
  error: boolean;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {loading ? <div className="h-8 w-20 animate-pulse rounded bg-muted/50" /> : null}
        {!loading && error ? <p className="text-sm text-destructive">Failed to load</p> : null}
        {!loading && !error ? <p className="text-3xl font-semibold">{count ?? 0}</p> : null}
      </CardContent>
    </Card>
  );
}
