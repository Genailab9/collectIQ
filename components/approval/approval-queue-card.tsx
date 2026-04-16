"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveRequest,
  counterOfferRequest,
  fetchCollectiqFeatureFlags,
  fetchPendingApprovals,
  getExecutionTrace,
  rejectRequest,
} from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { useToast } from "@/components/ui/toast-provider";
import { labelState } from "@/lib/state-copy";
import { cn } from "@/lib/utils";
const QUERY_KEY = ["approvals-pending"] as const;

export function ApprovalQueueCard() {
  const [officerId, setOfficerId] = useState("officer-1");
  const [counterOfferByCase, setCounterOfferByCase] = useState<Record<string, string>>({});
  const [historyCaseId, setHistoryCaseId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [singleBusyId, setSingleBusyId] = useState<string | null>(null);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const pendingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchPendingApprovals(),
    retry: 1,
  });
  const flagsQuery = useQuery({
    queryKey: ["feature-flags", "approvals"],
    queryFn: () => fetchCollectiqFeatureFlags(),
    retry: 1,
  });
  const historyQuery = useQuery({
    queryKey: ["approval-history", historyCaseId],
    queryFn: () => getExecutionTrace(historyCaseId ?? ""),
    enabled: !!historyCaseId,
    retry: 1,
  });

  const sorted = useMemo(
    () =>
      [...(pendingQuery.data ?? [])].sort(
        (a, b) => (b.priority?.score ?? 0) - (a.priority?.score ?? 0),
      ),
    [pendingQuery.data],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = useMemo(
    () => sorted.length > 0 && sorted.every((x) => selectedSet.has(x.correlationId)),
    [selectedSet, sorted],
  );
  const toggleSelected = useCallback((correlationId: string) => {
    setSelected((prev) =>
      prev.includes(correlationId)
        ? prev.filter((x) => x !== correlationId)
        : [...prev, correlationId],
    );
  }, []);

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

  const runSingleDecision = async (
    correlationId: string,
    fromState: string,
    mode: "approve" | "reject" | "counter",
  ) => {
    setSingleBusyId(correlationId);
    try {
      if (mode === "approve") {
        await approveRequest({
          correlationId,
          fromState,
          officerId: officerId.trim() || "officer-1",
        });
      } else if (mode === "reject") {
        await rejectRequest({
          correlationId,
          fromState,
          officerId: officerId.trim() || "officer-1",
        });
      } else {
        const raw = counterOfferByCase[correlationId] ?? "";
        const counterOfferAmountCents = Number(raw);
        if (!Number.isInteger(counterOfferAmountCents) || counterOfferAmountCents <= 0) {
          throw new Error("Counter offer must be a positive amount in cents.");
        }
        await counterOfferRequest({
          correlationId,
          fromState,
          officerId: officerId.trim() || "officer-1",
          counterOfferAmountCents,
        });
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      showToast({
        title: mode === "approve" ? "Case approved" : mode === "reject" ? "Case rejected" : "Counter offer sent",
        description: correlationId,
        variant: "success",
      });
    } catch (error) {
      showToast({
        title:
          mode === "approve" ? "Approve failed" : mode === "reject" ? "Reject failed" : "Counter offer failed",
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
          Loaded from <span className="font-mono">GET /approvals/pending</span> (shared domain polling).
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

        {pendingQuery.isLoading ? <SkeletonTable rows={4} /> : null}

        {!pendingQuery.isLoading && sorted.length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-center">
            <p className="text-sm text-muted-foreground">No pending approvals.</p>
            {flagsQuery.data?.flags?.DEMO_MODE ? (
              <Link href="/demo" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3")}>
                Run Demo Seed
              </Link>
            ) : null}
          </div>
        ) : null}

        {sorted.length > 0 ? (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
            {sorted.map((item) => {
              const checked = selectedSet.has(item.correlationId);
              const riskScore = Math.min(100, Math.max(0, item.priority?.score ?? 0));
              const confidence = Math.min(100, Math.max(35, 100 - Math.floor(riskScore / 1.5)));
              return (
                <motion.div
                  key={item.correlationId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="space-y-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(item.correlationId)}
                      />
                      <span className="font-mono text-sm font-medium">{item.correlationId}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Risk {riskScore}</Badge>
                      <Badge variant="secondary">Confidence {confidence}%</Badge>
                      <Badge variant="secondary">{labelState(item.currentState)}</Badge>
                    </div>
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
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={bulkMutation.isPending || singleBusyId === item.correlationId}
                      onClick={() => runSingleDecision(item.correlationId, item.currentState, "counter")}
                    >
                      {singleBusyId === item.correlationId ? "Working..." : "Counter Offer"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setHistoryCaseId((prev) => (prev === item.correlationId ? null : item.correlationId))
                      }
                    >
                      {historyCaseId === item.correlationId ? "Hide History" : "Show History"}
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      value={counterOfferByCase[item.correlationId] ?? ""}
                      onChange={(e) =>
                        setCounterOfferByCase((prev) => ({ ...prev, [item.correlationId]: e.target.value }))
                      }
                      type="number"
                      min={1}
                      placeholder="Counter offer (cents)"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    />
                    <p className="flex items-center text-xs text-muted-foreground">
                      Sends APPROVAL decision=COUNTER and reopens negotiation.
                    </p>
                  </div>
                  {historyCaseId === item.correlationId ? (
                    <div className="rounded-md border bg-muted/30 p-3 text-xs">
                      <p className="mb-2 font-medium">Negotiation History</p>
                      {historyQuery.isLoading ? (
                        <p className="text-muted-foreground">Loading history...</p>
                      ) : historyQuery.isError ? (
                        <p className="text-destructive">
                          {(historyQuery.error as { message?: string })?.message ?? "Failed to load history."}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {(historyQuery.data?.transitions ?? [])
                            .filter((t) => t.machine === "CALL" || t.machine === "APPROVAL")
                            .slice(-8)
                            .map((t, idx) => (
                              <p key={`${t.occurredAt}-${idx}`} className="font-mono text-[11px]">
                                {new Date(t.occurredAt).toLocaleTimeString()} · {t.machine} {t.from} → {t.to}
                              </p>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
