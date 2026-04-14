"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approveRequest, fetchPendingApprovals, rejectRequest, type PendingApprovalItem } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { useAuthUser } from "@/lib/use-auth-user";

const POLL_MS = 8000;
const QUERY_KEY = ["approvals-pending"] as const;

type RowProps = {
  item: PendingApprovalItem;
  officerId: string;
};

function ApprovalRequestRow({ item, officerId }: RowProps) {
  const [lastFailedAction, setLastFailedAction] = useState<null | (() => void)>(null);
  const { showToast } = useToast();
  const authUser = useAuthUser();
  const isOperator = authUser.data?.role === "operator";
  const queryClient = useQueryClient();

  const currentState = item.currentState;
  const canDecide =
    currentState === "PENDING" ||
    currentState === "REQUESTED" ||
    currentState === "COUNTERED" ||
    currentState === "TIMEOUT" ||
    currentState === "ESCALATED";

  const approveMutation = useMutation({
    mutationFn: () =>
      approveRequest({
        correlationId: item.correlationId,
        fromState: currentState,
        officerId,
      }),
    onSuccess: async () => {
      setLastFailedAction(null);
      showToast({ title: "Approved", description: item.correlationId, variant: "success" });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setLastFailedAction(() => () => approveMutation.mutate());
      showToast({
        title: "Approve failed",
        description: (error as { message?: string })?.message ?? "Approve failed.",
        variant: "error",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      rejectRequest({
        correlationId: item.correlationId,
        fromState: currentState,
        officerId,
      }),
    onSuccess: async () => {
      setLastFailedAction(null);
      showToast({ title: "Rejected", description: item.correlationId, variant: "success" });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setLastFailedAction(() => () => rejectMutation.mutate());
      showToast({
        title: "Reject failed",
        description: (error as { message?: string })?.message ?? "Reject failed.",
        variant: "error",
      });
    },
  });

  const isBusy = approveMutation.isPending || rejectMutation.isPending;
  const negotiated =
    item.negotiatedAmountCents != null ? `${(item.negotiatedAmountCents / 100).toFixed(2)}` : "—";
  const priorityLabel =
    item.priority?.label != null || item.priority?.score != null
      ? [item.priority?.label, item.priority?.score != null ? `#${item.priority.score}` : null]
          .filter(Boolean)
          .join(" ")
      : "—";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-sm font-medium">{item.correlationId}</div>
        <Badge
          variant={
            currentState === "APPROVED"
              ? "default"
              : currentState === "REJECTED"
                ? "destructive"
                : "secondary"
          }
        >
          {currentState}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">Queue: {item.queueStage}</div>

      <div className="grid gap-2 text-sm md:grid-cols-2">
        <div>
          <span className="text-muted-foreground">Borrower: </span>
          <span>{item.borrower.name ?? "—"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Phone: </span>
          <span>{item.borrower.phone ?? "—"}</span>
        </div>
      </div>
      <div className="grid gap-2 text-sm md:grid-cols-2">
        <div>
          <span className="text-muted-foreground">Negotiated: </span>
          <span>{negotiated}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Priority: </span>
          <span>{priorityLabel}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={isBusy || !canDecide} onClick={() => approveMutation.mutate()}>
          Approve
        </Button>
        <Button
          variant="destructive"
          disabled={isBusy || !canDecide || isOperator}
          onClick={() => rejectMutation.mutate()}
        >
          Reject
        </Button>
      </div>

      {!canDecide ? (
        <p className="text-xs text-muted-foreground">Decision not allowed in state {currentState}.</p>
      ) : null}
      {isOperator ? <p className="text-xs text-muted-foreground">Operator role cannot reject approvals.</p> : null}
      {lastFailedAction ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-xs text-muted-foreground">Decision action failed.</p>
          <Button size="sm" variant="secondary" className="mt-2" disabled={isBusy} onClick={lastFailedAction}>
            Retry last action
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ApprovalQueueCard() {
  const [officerId, setOfficerId] = useState("officer-1");

  const pendingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchPendingApprovals(),
    refetchInterval: POLL_MS,
    retry: 1,
  });

  const sorted = [...(pendingQuery.data ?? [])].sort((a, b) => {
    const sa = a.priority?.score ?? 0;
    const sb = b.priority?.score ?? 0;
    return sb - sa;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval queue</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Loaded from <span className="font-mono">GET /approvals/pending</span> (refreshes every {POLL_MS / 1000}s).
        </p>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="text-sm text-muted-foreground">
            Officer ID
            <input
              value={officerId}
              onChange={(e) => setOfficerId(e.target.value)}
              placeholder="Officer ID"
              className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <div className="flex items-end">
            <Button variant="secondary" disabled={pendingQuery.isFetching} onClick={() => pendingQuery.refetch()}>
              Refresh now
            </Button>
          </div>
        </div>

        {pendingQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {(pendingQuery.error as { message?: string })?.message ?? "Failed to load pending approvals."}
          </div>
        ) : null}

        {pendingQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading queue…</p> : null}

        {!pendingQuery.isLoading && sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items waiting for approval.</p>
        ) : null}

        {sorted.length > 0 ? (
          <div className="space-y-3">
            {sorted.map((item) => (
              <ApprovalRequestRow key={item.correlationId} item={item} officerId={officerId.trim() || "officer-1"} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
