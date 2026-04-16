"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { getSaaSTenantMe, getStoredTenantId } from "@/lib/api-client";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";

export function TenantIsolationBar() {
  const tenantId = getStoredTenantId();
  const refetchInterval = usePollingPolicy({ mode: "idle" });
  const q = useQuery({
    queryKey: ["saas-tenant-me", tenantId],
    queryFn: () => getSaaSTenantMe(),
    refetchInterval,
    retry: 1,
    enabled: !!tenantId,
  });
  if (!tenantId) {
    return (
      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        Set an active tenant using the switcher below (admins) or{" "}
        <span className="font-mono">localStorage collectiq:tenantId</span> before calling the CollectIQ API.
      </div>
    );
  }
  if (!q.data) {
    return null;
  }
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <div>
        <span className="text-muted-foreground">Active tenant: </span>
        <span className="font-mono font-medium">{q.data.tenantId}</span>
        <Badge variant="outline" className="ml-2">
          {q.data.plan}
        </Badge>
        {!q.data.enabled ? (
          <Badge variant="destructive" className="ml-2">
            disabled
          </Badge>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        Cases {q.data.usage.cases} · API {q.data.usage.apiCalls} · Payments {q.data.usage.paymentsProcessed}
      </div>
    </div>
  );
}
