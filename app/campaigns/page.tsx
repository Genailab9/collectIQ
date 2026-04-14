"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCampaignApi, getAnalyticsCampaign, listCampaignsApi } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const listQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaignsApi(),
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createCampaignApi({
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
      }),
    onSuccess: (row) => {
      setName("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setSelectedId(row.id);
      showToast({ title: "Campaign created", description: row.name, variant: "success" });
    },
    onError: (err) => {
      showToast({
        title: "Create failed",
        description: (err as { message?: string })?.message ?? "Could not create campaign.",
        variant: "error",
      });
    },
  });

  const analyticsQuery = useQuery({
    queryKey: ["analytics-campaign", selectedId],
    queryFn: () => getAnalyticsCampaign(selectedId),
    enabled: selectedId.trim().length > 0,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <p className="text-sm text-muted-foreground">
        Create a campaign on the server, then upload a CSV on the ingestion page for that campaign.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Create campaign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Creating…" : "Create campaign"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your campaigns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {listQuery.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
          {listQuery.isError ? (
            <p className="text-destructive">
              {(listQuery.error as { message?: string })?.message ?? "Failed to load campaigns."}
            </p>
          ) : null}
          {!listQuery.isLoading && (listQuery.data?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground">No campaigns yet. Create one above.</p>
          ) : null}
          <ul className="space-y-2">
            {(listQuery.data ?? []).map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{c.id}</div>
                  <div className="text-xs text-muted-foreground">Status: {c.status}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/ingestion?campaignId=${encodeURIComponent(c.id)}`}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                  >
                    Upload CSV
                  </Link>
                  <Button size="sm" variant="outline" onClick={() => setSelectedId(c.id)}>
                    View analytics
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campaign analytics (server)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="block text-muted-foreground">
            Campaign
            <select
              className="mt-1 h-10 w-full max-w-md rounded-md border bg-background px-3"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Choose campaign…</option>
              {(listQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {analyticsQuery.data ? (
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <div>
                Cases (distinct correlation ids):{" "}
                <span className="font-semibold">{analyticsQuery.data.aggregates.caseCount}</span>
              </div>
              <div>
                Payment successes:{" "}
                <span className="font-semibold">{analyticsQuery.data.aggregates.paymentSuccessDistinct}</span>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto">
                {JSON.stringify(analyticsQuery.data.aggregates.latestStateByMachine, null, 2)}
              </pre>
            </div>
          ) : null}
          {analyticsQuery.isError ? (
            <p className="text-destructive">Unable to load campaign analytics from the API.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
