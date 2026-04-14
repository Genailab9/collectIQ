"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantFeatureFlags } from "@/lib/api-client";

export default function DeploymentSettingsPage() {
  const flags = useQuery({ queryKey: ["tenant-feature-flags"], queryFn: () => getTenantFeatureFlags() });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Deployment & Feature Flags</h1>
      <Card>
        <CardHeader>
          <CardTitle>Runtime feature toggles (tenant-scoped read)</CardTitle>
        </CardHeader>
        <CardContent>
          {flags.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {flags.data ? (
            <pre className="rounded bg-muted p-3 text-xs">{JSON.stringify(flags.data, null, 2)}</pre>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Values come from backend <span className="font-mono">COLLECTIQ_FEATURE_*</span> environment variables.
            Maintenance mode for the web app uses{" "}
            <span className="font-mono">NEXT_PUBLIC_COLLECTIQ_MAINTENANCE=1</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
