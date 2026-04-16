"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCollectiqFeatureFlags, postSystemSimulation } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";

function readFlag(flags: Record<string, unknown> | undefined, key: string): boolean {
  const v = flags?.[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

export default function SimulationSettingsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const flagsQuery = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => fetchCollectiqFeatureFlags(),
    retry: 1,
  });

  const simMutation = useMutation({
    mutationFn: (body: Parameters<typeof postSystemSimulation>[0]) => postSystemSimulation(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["feature-flags"] });
      showToast({ title: "Simulation flags updated", variant: "success" });
    },
    onError: (e) =>
      showToast({
        title: "Update failed",
        description: (e as { message?: string })?.message ?? "Could not persist simulation flags.",
        variant: "error",
      }),
  });

  const flags = flagsQuery.data?.flags as Record<string, unknown> | undefined;
  const payFail = readFlag(flags, "SIMULATE_PAYMENT_FAILURE");
  const apprTimeout = readFlag(flags, "SIMULATE_APPROVAL_TIMEOUT");
  const callFail = readFlag(flags, "SIMULATE_CALL_FAILURE");

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Failure simulation</h1>
      <p className="text-sm text-muted-foreground">
        Tenant-scoped toggles stored as feature flags. Changes apply on the next adapter / policy evaluation path.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Toggles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Simulate payment failure</div>
              <p className="text-xs text-muted-foreground">Confirm payment returns failed status in the payment bridge.</p>
            </div>
            <input
              id="sim-pay"
              type="checkbox"
              className="size-4 accent-primary"
              checked={payFail}
              disabled={flagsQuery.isLoading || simMutation.isPending}
              onChange={(e) => simMutation.mutate({ simulatePaymentFailure: e.target.checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Simulate approval timeout</div>
              <p className="text-xs text-muted-foreground">Policy evaluation resolves to TIMEOUT.</p>
            </div>
            <input
              id="sim-appr"
              type="checkbox"
              className="size-4 accent-primary"
              checked={apprTimeout}
              disabled={flagsQuery.isLoading || simMutation.isPending}
              onChange={(e) => simMutation.mutate({ simulateApprovalTimeout: e.target.checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Simulate call failure</div>
              <p className="text-xs text-muted-foreground">Initiate call throws in the telephony execution bridge.</p>
            </div>
            <input
              id="sim-call"
              type="checkbox"
              className="size-4 accent-primary"
              checked={callFail}
              disabled={flagsQuery.isLoading || simMutation.isPending}
              onChange={(e) => simMutation.mutate({ simulateCallFailure: e.target.checked })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
