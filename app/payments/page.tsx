"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchCollectiqFeatureFlags, fetchPendingPayments } from "@/lib/api-client";
import { labelState } from "@/lib/state-copy";
import { PaymentStatusCard } from "@/components/payment/payment-status-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@/components/ui/table";

export default function PaymentsPage() {
  const pendingQuery = useQuery({
    queryKey: ["payments-pending"],
    queryFn: () => fetchPendingPayments(),
    retry: 1,
  });
  const flagsQuery = useQuery({
    queryKey: ["feature-flags", "payments"],
    queryFn: () => fetchCollectiqFeatureFlags(),
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Demo step: confirm one payment to show recovery completion and timeline closure.
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
          {pendingQuery.isLoading ? <SkeletonTable rows={4} /> : null}
          {!pendingQuery.isLoading && (pendingQuery.data?.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed p-5 text-center">
              <p className="text-sm text-muted-foreground">All payments completed.</p>
              {flagsQuery.data?.flags?.DEMO_MODE ? (
                <Link href="/demo" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3")}>
                  Run Demo Seed
                </Link>
              ) : null}
            </div>
          ) : null}
          {(pendingQuery.data?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead> </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  <AnimatePresence initial={false}>
                  {(pendingQuery.data ?? []).map((row) => (
                    <motion.tr
                      key={row.paymentId}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="border-t"
                    >
                      <TableCell className="font-mono text-xs">{row.paymentId}</TableCell>
                      <TableCell>
                        {row.amountCents != null ? `$${(row.amountCents / 100).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={row.currentState === "SUCCESS" ? "rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-600 pulse-soft" : ""}>
                          {labelState(row.currentState)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/execution/${encodeURIComponent(row.correlationId)}`}
                          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                        >
                          Open case
                        </Link>
                      </TableCell>
                    </motion.tr>
                  ))}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PaymentStatusCard />
    </div>
  );
}
