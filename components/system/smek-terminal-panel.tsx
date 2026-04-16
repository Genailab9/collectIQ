"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStructuredLogExport } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePollingPolicy } from "@/hooks/usePollingPolicy";

export function SmekTerminalPanel() {
  const [open, setOpen] = useState(false);
  const refetchInterval = usePollingPolicy({ mode: "active", whenOpen: open, enabled: open });
  const logsQuery = useQuery({
    queryKey: ["smek-terminal-logs"],
    queryFn: () => fetchStructuredLogExport(30),
    refetchInterval,
    enabled: open,
  });

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Open SMEK Terminal
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>SMEK Terminal Stream</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Collapse
        </Button>
      </CardHeader>
      <CardContent>
        <div className="max-h-64 overflow-auto rounded-md bg-black p-3 font-mono text-xs text-emerald-300">
          {(logsQuery.data ?? []).map((row, idx) => (
            <div key={idx}>
              [{row.timestamp ?? row.at ?? "—"}] {row.surface ?? "SMEK"} {row.result ?? "EVENT"} ::{" "}
              {row.message ?? `${row.adapter ?? "adapter"} ${row.phase ?? ""}`.trim()}
            </div>
          ))}
          {!logsQuery.data?.length ? <div>Waiting for events...</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
