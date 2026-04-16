"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { fetchPendingApprovals, fetchPendingPayments } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const [open, setOpen] = useState(false);

  const approvalsQuery = useQuery({
    queryKey: ["approvals-pending"],
    queryFn: () => fetchPendingApprovals(),
    retry: 1,
  });

  const paymentsQuery = useQuery({
    queryKey: ["payments-pending"],
    queryFn: () => fetchPendingPayments(),
    retry: 1,
  });

  const approvalCount = approvalsQuery.data?.length ?? 0;
  const paymentCount = paymentsQuery.data?.length ?? 0;
  const total = approvalCount + paymentCount;

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        <Bell className="size-4" />
        <span className="ml-2">Queues</span>
        {total > 0 ? (
          <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-xs">
            {total}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-md border bg-background p-3 shadow-xl">
          <p className="mb-2 text-sm font-medium">Work queues</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Counts from live APIs (shared domain polling is managed centrally).
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded border p-2">
              <span>Pending approvals</span>
              <span className="font-semibold">{approvalCount}</span>
            </div>
            <div className="flex items-center justify-between rounded border p-2">
              <span>Pending payments</span>
              <span className="font-semibold">{paymentCount}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
            <Link href="/approvals" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Approvals
            </Link>
            <Link href="/payments" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Payments
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
