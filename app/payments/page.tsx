"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchPendingPayments } from "@/lib/api-client";
import { labelState } from "@/lib/state-copy";
import { PaymentStatusCard } from "@/components/payment/payment-status-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const POLL_MS = 8000;

export default function PaymentsPage() {
  const pendingQuery = useQuery({
    queryKey: ["payments-pending"],
    queryFn: () => fetchPendingPayments(),
    refetchInterval: POLL_MS,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Pending queue from <span className="font-mono">GET /payments/pending</span> (refreshes every{" "}
            {POLL_MS / 1000}s).
          </p>
        </div>
        <Button variant="secondary" disabled={pendingQuery.isFetching} onClick={() => pendingQuery.refetch()}>
          Refresh now
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending payments</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingQuery.isError ? (
            <p className="text-sm text-destructive">
              {(pendingQuery.error as { message?: string })?.message ?? "Failed to load pending payments."}
            </p>
          ) : null}
          {pendingQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : null}
          {!pendingQuery.isLoading && (pendingQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">All payments completed.</p>
          ) : null}
          {(pendingQuery.data?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Payment ID</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">State</th>
                    <th className="py-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {(pendingQuery.data ?? []).map((row) => (
                    <tr key={row.paymentId} className="border-t">
                      <td className="py-2 pr-4 font-mono text-xs">{row.paymentId}</td>
                      <td className="py-2 pr-4">
                        {row.amountCents != null ? `$${(row.amountCents / 100).toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 pr-4">{labelState(row.currentState)}</td>
                      <td className="py-2">
                        <Link
                          href={`/execution/${encodeURIComponent(row.correlationId)}`}
                          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                        >
                          Open case
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PaymentStatusCard />
    </div>
  );
}
