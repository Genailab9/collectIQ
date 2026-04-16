"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchActiveExecutions,
  fetchPendingApprovals,
  fetchPendingPayments,
  listCampaignsApi,
} from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  params: {
    id: string;
  };
};

export default function CampaignDetailPage({ params }: Props) {
  const campaignId = decodeURIComponent(params.id);
  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaignsApi(),
  });
  const activeQuery = useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
  });
  const approvalsQuery = useQuery({
    queryKey: ["approvals-pending"],
    queryFn: () => fetchPendingApprovals(),
  });
  const paymentsQuery = useQuery({
    queryKey: ["payments-pending"],
    queryFn: () => fetchPendingPayments(),
  });

  const campaign = useMemo(
    () => (campaignsQuery.data ?? []).find((c) => c.id === campaignId) ?? null,
    [campaignId, campaignsQuery.data],
  );

  const cases = useMemo(
    () => (activeQuery.data ?? []).filter((x) => x.campaignId === campaignId),
    [activeQuery.data, campaignId],
  );
  const caseIds = useMemo(() => new Set(cases.map((x) => x.correlationId)), [cases]);
  const approvalsCount = useMemo(
    () => (approvalsQuery.data ?? []).filter((a) => caseIds.has(a.correlationId)).length,
    [approvalsQuery.data, caseIds],
  );
  const paymentsCount = useMemo(
    () => (paymentsQuery.data ?? []).filter((p) => caseIds.has(p.correlationId)).length,
    [paymentsQuery.data, caseIds],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campaign detail</h1>
          <p className="font-mono text-xs text-muted-foreground">{campaignId}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/data-ingestion/upload?campaignId=${encodeURIComponent(campaignId)}`}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Upload accounts
          </Link>
          <Link href="/campaigns" className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>
            Back to campaigns
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign status</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{campaign?.status ?? "Unknown"}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution cases</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{cases.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approvals pending</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{approvalsCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments pending</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{paymentsCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {campaignsQuery.isLoading ? <SkeletonTable rows={2} /> : null}
          {!campaignsQuery.isLoading && !campaign ? (
            <p className="text-destructive">Campaign not found for this tenant.</p>
          ) : null}
          {campaign ? (
            <>
              <p>
                <span className="text-muted-foreground">Name:</span> {campaign.name}
              </p>
              <p>
                <span className="text-muted-foreground">Description:</span> {campaign.description ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Created:</span>{" "}
                {new Date(campaign.createdAt).toLocaleString()}
              </p>
              <p>
                <span className="text-muted-foreground">Updated:</span>{" "}
                {new Date(campaign.updatedAt).toLocaleString()}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts / execution status</CardTitle>
        </CardHeader>
        <CardContent>
          {activeQuery.isLoading ? <SkeletonTable rows={5} /> : null}
          {!activeQuery.isLoading && cases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active execution rows for this campaign yet.</p>
          ) : null}
          <div className="space-y-2">
            {cases.map((row) => (
              <div key={row.correlationId} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <p className="font-mono text-xs">{row.correlationId}</p>
                  <p className="text-muted-foreground">{row.currentStateSummary}</p>
                </div>
                <Link
                  href={`/execution/${encodeURIComponent(row.correlationId)}`}
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                >
                  Open execution
                </Link>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

