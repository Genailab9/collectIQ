"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchActiveExecutions } from "@/lib/api-client";
import { labelState } from "@/lib/state-copy";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@/components/ui/table";

export default function ExecutionListPage() {
  const activeQuery = useQuery({
    queryKey: ["execution-active"],
    queryFn: () => fetchActiveExecutions(),
    retry: 1,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Active executions</h1>
          <p className="text-sm text-muted-foreground">
            From <span className="font-mono">GET /execution/active</span> — excludes cases whose latest SYNC state is
            COMPLETED. Uses shared domain polling.
          </p>
        </div>
        <Button variant="secondary" disabled={activeQuery.isFetching} onClick={() => activeQuery.refetch()}>
          Refresh now
        </Button>
      </div>

      {activeQuery.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(activeQuery.error as { message?: string })?.message ?? "Failed to load active executions."}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cases</CardTitle>
        </CardHeader>
        <CardContent>
          {activeQuery.isLoading ? <SkeletonTable rows={4} /> : null}
          {!activeQuery.isLoading && (activeQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No active cases.</p>
          ) : null}
          {(activeQuery.data?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Correlation</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>State summary</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead> </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  <AnimatePresence initial={false}>
                  {(activeQuery.data ?? []).map((row) => (
                    <motion.tr
                      key={row.correlationId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="border-t"
                    >
                      <TableCell className="font-mono text-xs">{row.correlationId}</TableCell>
                      <TableCell>{row.currentPhase}</TableCell>
                      <TableCell className="max-w-md truncate font-mono text-xs" title={row.currentStateSummary}>
                        {labelState(row.currentStateSummary)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.lastUpdatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.campaignId ?? "—"}</TableCell>
                      <TableCell>
                        <Link
                          href={`/execution/${encodeURIComponent(row.correlationId)}`}
                          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                        >
                          Detail
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
    </div>
  );
}
