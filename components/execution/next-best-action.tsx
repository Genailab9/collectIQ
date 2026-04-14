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
};

export function NextBestAction({ correlationId, machineStates }: Props) {
  const { showToast } = useToast();
  const callState = machineStates.CALL ?? "NOT_STARTED";
  const approvalState = machineStates.APPROVAL ?? "NOT_STARTED";
  const paymentState = machineStates.PAYMENT ?? "NOT_STARTED";

  const action = useMemo(() => {
    if (["PENDING", "REQUESTED", "ESCALATED", "COUNTERED", "TIMEOUT"].includes(approvalState)) {
      return { kind: "approve" as const, title: "Approve Case", detail: "This case is waiting in approval queue." };
    }
    if (paymentState === "PROCESSING") {
      return { kind: "retry-payment" as const, title: "Retry Payment", detail: "Payment is processing; review and retry from Payments panel." };
    }
    if (callState === "NEGOTIATING") {
      return { kind: "submit-approval" as const, title: "Submit For Approval", detail: "Call negotiation is done; move case to approval." };
    }
    if (["NOT_STARTED", "INITIATED", "RINGING", "CONNECTED", "AUTHENTICATED"].includes(callState)) {
      return { kind: "call" as const, title: "Initiate Call Flow", detail: "Case still needs call progression before approval." };
    }
    return null;
  }, [approvalState, callState, paymentState]);

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
    return (
      <Card>
        <CardHeader>
          <CardTitle>Next Best Action</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No immediate action recommended.</CardContent>
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
        {action.kind === "call" ? (
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "secondary" }))}>
            Open Call Controls
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
