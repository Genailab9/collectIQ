"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approveRequest, fetchPendingApprovals, rejectRequest } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { labelState } from "@/lib/state-copy";

const POLL_MS = 8000;
const QUERY_KEY = ["approvals-pending"] as const;

export function ApprovalQueueCard() {
  const [officerId, setOfficerId] = useState("officer-1");
  const [selected, setSelected] = useState<string[]>([]);
  const [singleBusyId, setSingleBusyId] = useState<string | null>(null);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const pendingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchPendingApprovals(),
    refetchInterval: POLL_MS,
    retry: 1,
  });

  const sorted = [...(pendingQuery.data ?? [])].sort(
    (a, b) => (b.priority?.score ?? 0) - (a.priority?.score ?? 0),
  );
  const selectedSet = new Set(selected);
  const allSelected = sorted.length > 0 && sorted.every((x) => selectedSet.has(x.correlationId));

  const bulkMutation = useMutation({
    mutationFn: async (mode: "approve" | "reject") => {
      const rows = sorted.filter((r) => selectedSet.has(r.correlationId));
      await Promise.all(
        rows.map((row) =>
          mode === "approve"
            ? approveRequest({
                correlationId: row.correlationId,
                fromState: row.currentState,
                officerId: officerId.trim() || "officer-1",
              })
            : rejectRequest({
                correlationId: row.correlationId,
                fromState: row.currentState,
                officerId: officerId.trim() || "officer-1",
              }),
        ),
      );
      return { mode, count: rows.length };
    },
    onSuccess: async ({ mode, count }) => {
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      showToast({
        title: mode === "approve" ? "Bulk approve complete" : "Bulk reject complete",
        description: `${count} case(s) processed.`,
        variant: "success",
      });
    },
    onError: (error) =>
      showToast({
        title: "Bulk action failed",
        description: (error as { message?: string })?.message ?? "Could not process selected cases.",
        variant: "error",
      }),
  });

  const runSingleDecision = async (correlationId: string, fromState: string, mode: "approve" | "reject") => {
    setSingleBusyId(correlationId);
    try {
      if (mode === "approve") {
        await approveRequest({
          correlationId,
          fromState,
          officerId: officerId.trim() || "officer-1",
        });
      } else {
        await rejectRequest({
          correlationId,
          fromState,
          officerId: officerId.trim() || "officer-1",
        });
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      showToast({
        title: mode === "approve" ? "Case approved" : "Case rejected",
        description: correlationId,
        variant: "success",
      });
    } catch (error) {
      showToast({
        title: mode === "approve" ? "Approve failed" : "Reject failed",
        description: (error as { message?: string })?.message ?? "Action failed.",
        variant: "error",
      });
    } finally {
      setSingleBusyId(null);
    }
  };

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

        {sorted.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? sorted.map((x) => x.correlationId) : [])}
              />
              Select all
            </label>
            <Button
              size="sm"
              disabled={bulkMutation.isPending || selected.length === 0}
              onClick={() => bulkMutation.mutate("approve")}
            >
              {bulkMutation.isPending ? "Working..." : "Approve Selected"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkMutation.isPending || selected.length === 0}
              onClick={() => bulkMutation.mutate("reject")}
            >
              {bulkMutation.isPending ? "Working..." : "Reject Selected"}
            </Button>
            <span className="text-xs text-muted-foreground">{selected.length} selected</span>
          </div>
        ) : null}

        {pendingQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {(pendingQuery.error as { message?: string })?.message ?? "Failed to load pending approvals."}
          </div>
        ) : null}

        {pendingQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-md border bg-muted/40" />
            ))}
          </div>
        ) : null}

        {!pendingQuery.isLoading && sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending approvals.</p>
        ) : null}

        {sorted.length > 0 ? (
          <div className="space-y-3">
            {sorted.map((item) => {
              const checked = selectedSet.has(item.correlationId);
              return (
                <div key={item.correlationId} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelected((prev) =>
                            prev.includes(item.correlationId)
                              ? prev.filter((x) => x !== item.correlationId)
                              : [...prev, item.correlationId],
                          )
                        }
                      />
                      <span className="font-mono text-sm font-medium">{item.correlationId}</span>
                    </label>
                    <Badge variant="secondary">{labelState(item.currentState)}</Badge>
                  </div>
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Borrower: </span>
                      <span>{item.borrower.name ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Phone: </span>
                      <span>{item.borrower.phone ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Negotiated amount: </span>
                      <span>
                        {item.negotiatedAmountCents != null
                          ? `$${(item.negotiatedAmountCents / 100).toFixed(2)}`
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Priority: </span>
                      <span>{item.priority?.label ?? "—"}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={bulkMutation.isPending || singleBusyId === item.correlationId}
                      onClick={() => runSingleDecision(item.correlationId, item.currentState, "approve")}
                    >
                      {singleBusyId === item.correlationId ? "Working..." : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={bulkMutation.isPending || singleBusyId === item.correlationId}
                      onClick={() => runSingleDecision(item.correlationId, item.currentState, "reject")}
                    >
                      {singleBusyId === item.correlationId ? "Working..." : "Reject"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
