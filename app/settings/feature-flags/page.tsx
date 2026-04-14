"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCollectiqFeatureFlags,
  postDemoReset,
  postDemoSeed,
  upsertCollectiqFeatureFlag,
  type CollectiqFeatureFlagKey,
} from "@/lib/api-client";
import { useAuthUser } from "@/lib/use-auth-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";

const FLAGS: Array<{ key: CollectiqFeatureFlagKey; label: string; description: string }> = [
  { key: "SIMULATE_CALLS", label: "Simulate calls", description: "Use simulated telephony where supported." },
  { key: "DEMO_MODE", label: "Demo mode", description: "Relaxed paths for demonstrations (tenant-scoped)." },
  {
    key: "FORCE_PAYMENT_SUCCESS",
    label: "Force payment success",
    description: "Testing-only: coerce successful payment transitions when enabled by backend.",
  },
];

const QUERY_KEY = ["collectiq-feature-flags"] as const;

function coerceBoolean(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

export default function FeatureFlagsSettingsPage() {
  const auth = useAuthUser();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const flagsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchCollectiqFeatureFlags(),
    enabled: auth.data?.role === "admin",
    retry: 1,
  });

  const seedMutation = useMutation({
    mutationFn: () => postDemoSeed(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      showToast({
        title: "Demo data seeded",
        description: `Campaign ${res.campaignId.slice(0, 8)}… — ${res.approvalCorrelationIds.length} cases.`,
        variant: "success",
      });
    },
    onError: (err) => {
      showToast({
        title: "Seed failed",
        description: (err as { message?: string })?.message ?? "Could not seed demo.",
        variant: "error",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => postDemoReset(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      showToast({
        title: "Demo reset",
        description: `Removed ${res.deletedCorrelationIds} correlation scope(s).`,
        variant: "success",
      });
    },
    onError: (err) => {
      showToast({
        title: "Reset failed",
        description: (err as { message?: string })?.message ?? "Could not reset demo.",
        variant: "error",
      });
    },
  });

  const upsertMutation = useMutation({
    mutationFn: (input: { key: CollectiqFeatureFlagKey; value: boolean }) =>
      upsertCollectiqFeatureFlag({ key: input.key, value: input.value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      showToast({ title: "Saved", description: "Feature flag updated.", variant: "success" });
    },
    onError: (err) => {
      showToast({
        title: "Save failed",
        description: (err as { message?: string })?.message ?? "Could not update flag.",
        variant: "error",
      });
    },
  });

  if (auth.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading session…</p>;
  }

  if (auth.data?.role !== "admin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Feature flags</h1>
        <p className="text-sm text-destructive">You need an administrator account to manage execution feature flags.</p>
      </div>
    );
  }

  const demoOn = coerceBoolean(flagsQuery.data?.flags?.DEMO_MODE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Feature flags</h1>
        <Badge variant={demoOn ? "default" : "secondary"}>{demoOn ? "Demo mode ON" : "Demo mode OFF"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Tenant-scoped flags via <span className="font-mono">GET/POST /feature-flags</span>. Changes apply to this
        tenant only.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Live demo control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Turn on <span className="font-medium text-foreground">DEMO_MODE</span>,{" "}
            <span className="font-medium text-foreground">SIMULATE_CALLS</span>, and{" "}
            <span className="font-medium text-foreground">FORCE_PAYMENT_SUCCESS</span> below, then seed. Reset removes
            the seeded campaign, cases, and related rows for this tenant (requires DEMO_MODE).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={seedMutation.isPending || resetMutation.isPending}
              onClick={() => seedMutation.mutate()}
            >
              {seedMutation.isPending ? "Seeding…" : "Seed demo data"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={seedMutation.isPending || resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
            >
              {resetMutation.isPending ? "Resetting…" : "Reset demo"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {flagsQuery.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(flagsQuery.error as { message?: string })?.message ?? "Failed to load flags."}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {FLAGS.map((f) => {
          const raw = flagsQuery.data?.flags?.[f.key];
          const on = coerceBoolean(raw);
          return (
            <Card key={f.key}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">{f.label}</CardTitle>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{on ? "On" : "Off"}</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={on}
                    disabled={flagsQuery.isLoading || upsertMutation.isPending}
                    onChange={(e) => upsertMutation.mutate({ key: f.key, value: e.target.checked })}
                  />
                </label>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{f.description}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">Key: {f.key}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
