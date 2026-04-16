"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchStructuredLogExport } from "@/lib/api-client";
import { labelState, stateTone } from "@/lib/state-copy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";

function toneClass(tone: ReturnType<typeof stateTone>): string {
  if (tone === "error") return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
  if (tone === "success") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (tone === "warning") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-muted bg-muted/30 text-foreground";
}

export function SystemActivityFeed({ compact = false }: { compact?: boolean }) {
  const refetchInterval = usePollingPolicy({ mode: compact ? "active" : "normal" });
  const feedQuery = useQuery({
    queryKey: ["system-activity", 50],
    queryFn: () => fetchStructuredLogExport(50),
    refetchInterval,
    retry: 1,
  });

  return (
    <Card className={compact ? "h-full" : ""}>
      <CardHeader>
        <CardTitle>System Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {feedQuery.isLoading ? <SkeletonTable rows={compact ? 6 : 5} /> : null}
        {feedQuery.isError ? (
          <p className="text-sm text-destructive">
            {(feedQuery.error as { message?: string })?.message ?? "Failed to load activity feed."}
          </p>
        ) : null}
        {!feedQuery.isLoading && !feedQuery.isError && (feedQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No activity events yet.</p>
        ) : null}
        <div className={`space-y-2 ${compact ? "max-h-[70vh] overflow-auto pr-1" : ""}`}>
          <AnimatePresence initial={false}>
          {(feedQuery.data ?? []).map((ev, idx) => {
            const status = ev.result ?? ev.surface ?? "Event";
            const fallbackText = `${ev.adapter ?? "system"} ${ev.phase ?? ""}`.trim();
            const text = ev.message ?? (fallbackText.length > 0 ? fallbackText : "Execution event");
            const at = ev.timestamp ?? ev.at ?? "";
            const tone = stateTone(status);
            const retryLike = /retry|circuit|backoff/i.test(text) || /retry/i.test(status);
            return (
              <motion.div
                key={`${at}-${idx}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={`rounded-md border p-3 text-xs ${toneClass(retryLike ? "warning" : tone)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{labelState(status)}</span>
                  <span className="text-muted-foreground">{at ? new Date(at).toLocaleTimeString() : "—"}</span>
                </div>
                <p className="mt-1 text-sm text-foreground">{text}</p>
                {ev.correlationId ? (
                  <Link
                    href={`/execution/${encodeURIComponent(ev.correlationId)}`}
                    className="mt-2 inline-block font-mono text-[11px] underline underline-offset-2"
                  >
                    {ev.correlationId}
                  </Link>
                ) : null}
              </motion.div>
            );
          })}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
