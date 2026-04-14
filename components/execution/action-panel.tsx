"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  approveRequest,
  confirmPayment,
  createPaymentIntent,
  rejectRequest,
  submitForApproval,
  triggerAuthenticate,
  triggerNegotiate,
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { useAuthUser } from "@/lib/use-auth-user";

type MachineStates = {
  CALL: string;
  APPROVAL: string;
  PAYMENT: string;
  SYNC: string;
};

export function ActionPanel({
  correlationId,
  machineStates,
}: {
  correlationId: string;
  machineStates: MachineStates;
}) {
  const [officerId, setOfficerId] = useState("officer-1");
  const [amountCents, setAmountCents] = useState(2500);
  const [gatewayPaymentIntentId, setGatewayPaymentIntentId] = useState("");
  const [lastFailedAction, setLastFailedAction] = useState<null | (() => void)>(null);
  const { showToast } = useToast();
  const authUser = useAuthUser();
  const isOperator = authUser.data?.role === "operator";

  const authenticateMutation = useMutation({
    mutationFn: () => triggerAuthenticate({ correlationId }),
    onSuccess: () => {
      setLastFailedAction(null);
      showToast({ title: "Authenticate triggered", variant: "success" });
    },
    onError: (error) => {
      setLastFailedAction(() => () => authenticateMutation.mutate());
      showToast({
        title: "Authenticate failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });
  const negotiateMutation = useMutation({
    mutationFn: () =>
      triggerNegotiate({
        correlationId,
        conversationTranscript: "Borrower conversation transcript captured.",
      }),
    onSuccess: () => {
      setLastFailedAction(null);
      showToast({ title: "Negotiate triggered", variant: "success" });
    },
    onError: (error) => {
      setLastFailedAction(() => () => negotiateMutation.mutate());
      showToast({
        title: "Negotiate failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });
  const submitApprovalMutation = useMutation({
    mutationFn: () => submitForApproval({ correlationId }),
    onSuccess: () => {
      setLastFailedAction(null);
      showToast({ title: "Submitted for approval", variant: "success" });
    },
    onError: (error) => {
      setLastFailedAction(() => () => submitApprovalMutation.mutate());
      showToast({
        title: "Submit for approval failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });
  const approveMutation = useMutation({
    mutationFn: () =>
      approveRequest({
        correlationId,
        fromState: machineStates.APPROVAL === "NOT_STARTED" ? "PENDING" : machineStates.APPROVAL,
        officerId,
      }),
    onSuccess: () => {
      setLastFailedAction(null);
      showToast({ title: "Approved", variant: "success" });
    },
    onError: (error) => {
      setLastFailedAction(() => () => approveMutation.mutate());
      showToast({
        title: "Approve failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: () =>
      rejectRequest({
        correlationId,
        fromState: machineStates.APPROVAL === "NOT_STARTED" ? "PENDING" : machineStates.APPROVAL,
        officerId,
      }),
    onSuccess: () => {
      setLastFailedAction(null);
      showToast({ title: "Rejected", variant: "success" });
    },
    onError: (error) => {
      setLastFailedAction(() => () => rejectMutation.mutate());
      showToast({
        title: "Reject failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });
  const createIntentMutation = useMutation({
    mutationFn: () =>
      createPaymentIntent({
        amountCents,
        approvalCorrelationId: correlationId,
      }),
    onSuccess: (data) => {
      setGatewayPaymentIntentId(data.gatewayPaymentIntentId);
      setLastFailedAction(null);
      showToast({
        title: "Payment intent created",
        description: data.gatewayPaymentIntentId,
        variant: "success",
      });
    },
    onError: (error) => {
      setLastFailedAction(() => () => createIntentMutation.mutate());
      showToast({
        title: "Create payment intent failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });
  const confirmMutation = useMutation({
    mutationFn: () =>
      confirmPayment({
        paymentId: correlationId,
        gatewayPaymentIntentId,
      }),
    onSuccess: () => {
      setLastFailedAction(null);
      showToast({ title: "Payment confirmed", variant: "success" });
    },
    onError: (error) => {
      setLastFailedAction(() => () => confirmMutation.mutate());
      showToast({
        title: "Payment confirmation failed",
        description: (error as { message?: string })?.message ?? "Request failed.",
        variant: "error",
      });
    },
  });

  const anyLoading =
    authenticateMutation.isPending ||
    negotiateMutation.isPending ||
    submitApprovalMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    createIntentMutation.isPending ||
    confirmMutation.isPending;

  const callState = machineStates.CALL;

  return (
    <Card>
      <CardHeader>
        <CardTitle>State-Driven Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {callState === "CONNECTED" ? (
          <Button disabled={anyLoading} onClick={() => authenticateMutation.mutate()}>
            Authenticate
          </Button>
        ) : null}

        {callState === "AUTHENTICATED" ? (
          <Button disabled={anyLoading} onClick={() => negotiateMutation.mutate()}>
            Negotiate
          </Button>
        ) : null}

        {callState === "NEGOTIATING" ? (
          <Button disabled={anyLoading} onClick={() => submitApprovalMutation.mutate()}>
            Submit for Approval
          </Button>
        ) : null}

        {callState === "WAITING_APPROVAL" ? (
          <div className="space-y-2">
            <input
              value={officerId}
              onChange={(e) => setOfficerId(e.target.value)}
              placeholder="Officer ID"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
            <div className="flex gap-2">
              <Button disabled={anyLoading} onClick={() => approveMutation.mutate()}>
                Approve
              </Button>
              <Button
                variant="destructive"
                disabled={anyLoading || isOperator}
                onClick={() => rejectMutation.mutate()}
              >
                Reject
              </Button>
            </div>
          </div>
        ) : null}

        {machineStates.APPROVAL === "APPROVED" ? (
          <div className="space-y-2">
            <input
              value={amountCents}
              onChange={(e) => setAmountCents(Number(e.target.value) || 0)}
              type="number"
              placeholder="Amount cents"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={anyLoading || amountCents <= 0} onClick={() => createIntentMutation.mutate()}>
                Create Payment Intent
              </Button>
              <Button
                disabled={anyLoading || !gatewayPaymentIntentId.trim() || isOperator}
                onClick={() => confirmMutation.mutate()}
              >
                Confirm Payment
              </Button>
            </div>
            {isOperator ? (
              <p className="text-xs text-muted-foreground">Operator role cannot reject or confirm payment.</p>
            ) : null}
            {gatewayPaymentIntentId ? (
              <p className="text-xs text-muted-foreground">
                Gateway Intent: <span className="font-mono text-foreground">{gatewayPaymentIntentId}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {!["CONNECTED", "AUTHENTICATED", "NEGOTIATING", "WAITING_APPROVAL"].includes(callState) &&
        machineStates.APPROVAL !== "APPROVED" ? (
          <p className="text-sm text-muted-foreground">
            No interactive action available for current state.
          </p>
        ) : null}

        {lastFailedAction ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
            <p className="text-xs text-muted-foreground">Last action failed.</p>
            <Button size="sm" variant="secondary" className="mt-2" disabled={anyLoading} onClick={lastFailedAction}>
              Retry Last Action
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

