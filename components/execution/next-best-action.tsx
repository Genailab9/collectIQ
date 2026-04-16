"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { approveRequest, submitForApproval } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { cn } from "@/lib/utils";

type Props = {
  correlationId: string;
  machineStates: Record<string, string>;
  staleMinutes?: number | null;
};

export function NextBestAction({ correlationId, machineStates, staleMinutes = null }: Props) {
  const { showToast } = useToast();
  const callState = machineStates.CALL ?? "NOT_STARTED";
  const approvalState = machineStates.APPROVAL ?? "NOT_STARTED";
  const paymentState = machineStates.PAYMENT ?? "NOT_STARTED";
  const accountState = machineStates.ACCOUNT ?? "";
  const syncState = machineStates.SYNC ?? "";
  const isStale = staleMinutes != null && staleMinutes >= 3;

  const action = useMemo(() => {
    const isCaseClosed = accountState === "CLOSED" || syncState === "COMPLETED";
    if (isCaseClosed) {
      return null;
    }
    if (callState === "FAILED") {
      return {
        kind: "retry-call" as const,
        title: "Retry Call",
        detail: "Call flow failed. Re-open live calls to retry and move this case back into negotiation.",
      };
    }
    if (["PENDING", "REQUESTED", "ESCALATED", "COUNTER", "COUNTERED", "TIMEOUT"].includes(approvalState)) {
      return {
        kind: "approve" as const,
        title: "Approve Case",
        detail: "This case is waiting in approval queue. Approve now to continue demo flow into payment.",
      };
    }
    if (paymentState === "PROCESSING") {
      return {
        kind: "payment-processing" as const,
        title: "Complete Payment Confirmation",
        detail: "Payment is processing. Open Payments to confirm completion and move the case toward closure.",
      };
    }
    if (paymentState === "FAILED") {
      return {
        kind: "retry-payment" as const,
        title: "Retry Payment Flow",
        detail: "Payment failed. Re-open payment flow and retry with a fresh intent/confirmation.",
      };
    }
    if (callState === "NEGOTIATING") {
      return { kind: "submit-approval" as const, title: "Submit For Approval", detail: "Call negotiation is done; move case to approval." };
    }
    if (["NOT_STARTED", "INITIATED", "RINGING", "CONNECTED", "AUTHENTICATED"].includes(callState)) {
      return { kind: "call" as const, title: "Initiate Call Flow", detail: "Case still needs call progression before approval." };
    }
    return null;
  }, [accountState, approvalState, callState, paymentState, syncState]);

  const approveMutation = useMutation({
    mutationFn: () => approveRequest({ correlationId, fromState: approvalState, officerId: "demo-officer" }),
    onSuccess: () => showToast({ title: "Case approved", variant: "success" }),
    onError: (e) =>
      showToast({
        title: "Approve failed",
        description: (e as { message?: string })?.message ?? "Could not approve.",
        variant: "error",
      }),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitForApproval({ correlationId }),
    onSuccess: () => showToast({ title: "Submitted for approval", variant: "success" }),
    onError: (e) =>
      showToast({
        title: "Submit failed",
        description: (e as { message?: string })?.message ?? "Could not submit for approval.",
        variant: "error",
      }),
  });

  if (!action) {
    const closed = accountState === "CLOSED" || syncState === "COMPLETED";
    return (
      <Card>
        <CardHeader>
          <CardTitle>Next Best Action</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {closed ? "Case is closed — no further actions." : "No immediate action recommended."}
        </CardContent>
      </Card>
    );
  }

  const loading = approveMutation.isPending || submitMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next Best Action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isStale ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
            Stale execution detected: no new transitions for {staleMinutes} minutes. Refresh trace or retry the
            recommended action.
          </div>
        ) : null}
        <p className="text-sm font-medium">{action.title}</p>
        <p className="text-sm text-muted-foreground">{action.detail}</p>
        {action.kind === "approve" ? (
          <Button disabled={loading} onClick={() => approveMutation.mutate()}>
            {approveMutation.isPending ? "Approving..." : "Approve Case"}
          </Button>
        ) : null}
        {action.kind === "submit-approval" ? (
          <Button disabled={loading} onClick={() => submitMutation.mutate()}>
            {submitMutation.isPending ? "Submitting..." : "Submit For Approval"}
          </Button>
        ) : null}
        {action.kind === "retry-payment" ? (
          <Link href="/payments" className={cn(buttonVariants({ variant: "secondary" }))}>
            Open Payments Queue
          </Link>
        ) : null}
        {action.kind === "payment-processing" ? (
          <Link href="/payments" className={cn(buttonVariants({ variant: "secondary" }))}>
            Confirm Processing Payment
          </Link>
        ) : null}
        {action.kind === "retry-call" ? (
          <Link href="/calls/live" className={cn(buttonVariants({ variant: "secondary" }))}>
            Open Live Call Monitor
          </Link>
        ) : null}
        {action.kind === "call" ? (
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "secondary" }))}>
            Open Call Controls
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
