"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";

type TenantRow = {
  tenantId: string;
  displayName: string;
  plan: string;
  enabled: boolean;
  caseCount: number;
  apiCallCount: number;
  paymentProcessedCount: number;
};

async function fetchTenants(): Promise<TenantRow[]> {
  const res = await fetch("/api/saas/admin/tenants", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || "Failed to load tenants.");
  }
  return res.json() as Promise<TenantRow[]>;
}

export default function AdminPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const tenants = useQuery({ queryKey: ["admin-tenants"], queryFn: fetchTenants, retry: 1 });
  const recovery = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/saas/admin/recovery", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "Recovery trigger failed.");
      }
      return res.json();
    },
    onSuccess: () => {
      showToast({ variant: "success", title: "Webhook recovery sweep completed" });
    },
    onError: (e: Error) => {
      showToast({ variant: "error", title: "Recovery failed", description: e.message });
    },
  });

  const toggle = async (tenantId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/saas/admin/tenants/${encodeURIComponent(tenantId)}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "Update failed.");
      }
      await qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      showToast({
        variant: "success",
        title: enabled ? "Tenant enabled" : "Tenant disabled",
        description: tenantId,
      });
    } catch (e) {
      showToast({
        variant: "error",
        title: "Tenant update failed",
        description: e instanceof Error ? e.message : "Unknown error.",
      });
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin Control Plane</h1>
      <p className="text-sm text-muted-foreground">
        Manage tenant enablement, trigger webhook recovery sweeps, and review usage counters (server-side admin key).
      </p>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recovery</CardTitle>
          <Button size="sm" disabled={recovery.isPending} onClick={() => recovery.mutate()}>
            {recovery.isPending ? "Running…" : "Trigger recovery sweep"}
          </Button>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Invokes webhook recovery plus notes about execution recovery cron.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tenants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tenants.isError ? (
            <p className="text-sm text-destructive">{(tenants.error as Error).message}</p>
          ) : null}
          {tenants.data?.map((t) => (
            <div key={t.tenantId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
              <div>
                <div className="font-mono font-medium">{t.tenantId}</div>
                <div className="text-xs text-muted-foreground">
                  plan {t.plan} · cases {t.caseCount} · API {t.apiCallCount} · payments {t.paymentProcessedCount}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={t.enabled} onClick={() => toggle(t.tenantId, true)}>
                  Enable
                </Button>
                <Button size="sm" variant="destructive" disabled={!t.enabled} onClick={() => toggle(t.tenantId, false)}>
                  Disable
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
