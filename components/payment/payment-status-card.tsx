"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmPayment, createPaymentIntent, getExecutionTrace } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast-provider";
import { useAuthUser } from "@/lib/use-auth-user";

function badgeVariantForState(state: string) {
  if (state === "SUCCESS" || state === "COMPLETED") {
    return "default" as const;
  }
  if (state === "FAILED") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

function canRetryConfirm(state: string): boolean {
  return state === "FAILED" || state === "PAYMENT_PENDING" || state === "PROCESSING";
}

export function PaymentStatusCard() {
  const [approvalCorrelationIdInput, setApprovalCorrelationIdInput] = useState("");
  const [approvalCorrelationId, setApprovalCorrelationId] = useState("");
  const [amountCents, setAmountCents] = useState(2500);
  const [paymentId, setPaymentId] = useState("");
  const [gatewayPaymentIntentId, setGatewayPaymentIntentId] = useState("");
  const [lastFailedAction, setLastFailedAction] = useState<null | (() => void)>(null);
  const { showToast } = useToast();
  const authUser = useAuthUser();
  const isOperator = authUser.data?.role === "operator";

  const traceQuery = useQuery({
    queryKey: ["payment-trace", approvalCorrelationId],
    queryFn: () => getExecutionTrace(approvalCorrelationId),
    enabled: approvalCorrelationId.trim().length > 0,
    refetchInterval: 8000,
  });

  const paymentState = useMemo(() => {
    let latest = "NOT_STARTED";
    for (const t of traceQuery.data?.transitions ?? []) {
      if (t.machine === "PAYMENT") {
        latest = t.to;
      }
    }
    return latest;
  }, [traceQuery.data]);

  const createIntentMutation = useMutation({
    mutationFn: () =>
      createPaymentIntent({
        amountCents,
        approvalCorrelationId,
      }),
    onSuccess: (data) => {
      setPaymentId(data.paymentId);
      setGatewayPaymentIntentId(data.gatewayPaymentIntentId);
      setLastFailedAction(null);
      showToast({
        title: "Intent created",
        description: `State: ${data.toState}`,
        variant: "success",
      });
    },
    onError: (error) => {
      setLastFailedAction(() => () => createIntentMutation.mutate());
      showToast({
        title: "Create intent failed",
        description: (error as { message?: string })?.message ?? "Failed to create payment intent.",
        variant: "error",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      confirmPayment({
        paymentId,
        gatewayPaymentIntentId,
      }),
    onSuccess: (data) => {
      setLastFailedAction(null);
      showToast({
        title: "Payment confirmed",
        description: `State: ${data.toState}`,
        variant: "success",
      });
    },
    onError: (error) => {
      setLastFailedAction(() => () => confirmMutation.mutate());
      showToast({
        title: "Confirm payment failed",
        description: (error as { message?: string })?.message ?? "Failed to confirm payment.",
        variant: "error",
      });
    },
  });

  const allowRetry = canRetryConfirm(paymentState);
  const isBusy = createIntentMutation.isPending || confirmMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Interaction Panel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={approvalCorrelationIdInput}
            onChange={(e) => setApprovalCorrelationIdInput(e.target.value)}
            placeholder="Approval correlation ID"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
          <Button
            disabled={!approvalCorrelationIdInput.trim() || isBusy}
            onClick={() => setApprovalCorrelationId(approvalCorrelationIdInput.trim())}
          >
            Load Status
          </Button>
        </div>
        {traceQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading payment trace...</p> : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Amount</div>
            <div className="text-sm font-medium">{amountCents > 0 ? `${amountCents} cents` : "n/a"}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Gateway ID</div>
            <div className="truncate font-mono text-sm">{gatewayPaymentIntentId || "n/a"}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Status</div>
            <Badge variant={badgeVariantForState(paymentState)}>{paymentState}</Badge>
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Create intent</div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              value={amountCents}
              onChange={(e) => setAmountCents(Number(e.target.value) || 0)}
              type="number"
              min={1}
              placeholder="Amount in cents"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
            <Button
              disabled={isBusy || !approvalCorrelationId || amountCents <= 0}
              onClick={() => createIntentMutation.mutate()}
            >
              Create Intent
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Confirm payment</div>
          <input
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            placeholder="Payment ID"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
          <input
            value={gatewayPaymentIntentId}
            onChange={(e) => setGatewayPaymentIntentId(e.target.value)}
            placeholder="Gateway payment intent ID"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isBusy || !paymentId.trim() || !gatewayPaymentIntentId.trim() || isOperator}
              onClick={() => confirmMutation.mutate()}
            >
              Confirm Payment
            </Button>
            <Button
              variant="secondary"
              disabled={isBusy || !allowRetry || !paymentId.trim() || !gatewayPaymentIntentId.trim()}
              onClick={() => confirmMutation.mutate()}
            >
              Retry Confirm
            </Button>
          </div>
          {isOperator ? (
            <p className="text-xs text-muted-foreground">Operator role cannot confirm payment.</p>
          ) : null}
          {!allowRetry ? (
            <p className="text-xs text-muted-foreground">
              Retry is only allowed for FAILED, PAYMENT_PENDING, or PROCESSING states.
            </p>
          ) : null}
        </div>

        {traceQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">
              {(traceQuery.error as { message?: string })?.message ?? "Failed to load payment status."}
            </p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => traceQuery.refetch()}>
              Retry Load
            </Button>
          </div>
        ) : null}

        {lastFailedAction ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-muted-foreground">Action failed.</p>
            <Button size="sm" variant="secondary" className="mt-2" disabled={isBusy} onClick={lastFailedAction}>
              Retry Last Action
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

