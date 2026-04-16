"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchActiveExecutions, fetchPendingApprovals, fetchPendingPayments, listCampaignsApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Item = { id: string; label: string; action: () => void };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();

  const cachedApprovals = queryClient.getQueryData<Awaited<ReturnType<typeof fetchPendingApprovals>>>(["approvals-pending"]);
  const cachedPayments = queryClient.getQueryData<Awaited<ReturnType<typeof fetchPendingPayments>>>(["payments-pending"]);
  const cachedExecutions = queryClient.getQueryData<Awaited<ReturnType<typeof fetchActiveExecutions>>>(["execution-active"]);
  const cachedCampaigns = queryClient.getQueryData<Awaited<ReturnType<typeof listCampaignsApi>>>(["campaigns"]);

  const approvals = useQuery({
    queryKey: ["approvals-pending"],
    queryFn: () => fetchPendingApprovals(),
    enabled: open && !cachedApprovals,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const payments = useQuery({
    queryKey: ["payments-pending"],
    queryFn: () => fetchPendingPayments(),
    enabled: open && !cachedPayments,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const executions = useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
    enabled: open && !cachedExecutions,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaignsApi(),
    enabled: open && !cachedCampaigns,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = useMemo<Item[]>(() => {
    const builtins: Item[] = [
      { id: "go-dashboard", label: "Go to Dashboard", action: () => router.push("/dashboard") },
      { id: "go-campaigns", label: "Go to Campaigns", action: () => router.push("/campaigns") },
      { id: "go-approvals", label: "Go to Approvals", action: () => router.push("/approvals") },
      { id: "go-payments", label: "Go to Payments", action: () => router.push("/payments") },
      { id: "go-executions", label: "Go to Active Executions", action: () => router.push("/execution") },
      { id: "go-demo", label: "Go to Demo Cockpit", action: () => router.push("/demo") },
    ];
    const dynamic: Item[] = [
      ...((executions.data ?? cachedExecutions) ?? []).slice(0, 5).map((x) => ({
        id: `exec-${x.correlationId}`,
        label: `Open case ${x.correlationId}`,
        action: () => router.push(`/execution/${encodeURIComponent(x.correlationId)}`),
      })),
      ...((approvals.data ?? cachedApprovals) ?? []).slice(0, 4).map((x) => ({
        id: `approval-${x.correlationId}`,
        label: `Pending approval ${x.correlationId}`,
        action: () => router.push("/approvals"),
      })),
      ...((payments.data ?? cachedPayments) ?? []).slice(0, 4).map((x) => ({
        id: `payment-${x.paymentId}`,
        label: `Pending payment ${x.paymentId}`,
        action: () => router.push("/payments"),
      })),
      ...((campaigns.data ?? cachedCampaigns) ?? []).slice(0, 4).map((x) => ({
        id: `campaign-${x.id}`,
        label: `Campaign ${x.name}`,
        action: () => router.push(`/ingestion?campaignId=${encodeURIComponent(x.id)}`),
      })),
    ];
    return [...builtins, ...dynamic];
  }, [
    approvals.data,
    cachedApprovals,
    campaigns.data,
    cachedCampaigns,
    executions.data,
    cachedExecutions,
    payments.data,
    cachedPayments,
    router,
  ]);

  const filtered = items.filter((x) => x.label.toLowerCase().includes(term.toLowerCase()));
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/55 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="mx-auto mt-24 w-full max-w-2xl px-4" onClick={(e) => e.stopPropagation()}>
        <Card>
          <CardHeader>
            <CardTitle>Command Palette</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search routes, cases, campaigns..."
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              autoFocus
            />
            <div className="max-h-96 space-y-1 overflow-auto">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-sm transition-saas hover:bg-muted"
                  onClick={() => {
                    item.action();
                    setOpen(false);
                    setTerm("");
                  }}
                >
                  {item.label}
                </button>
              ))}
              {filtered.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No matches</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
