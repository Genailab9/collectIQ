"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadAuditReport } from "@/lib/api-client";
export default function AuditPage() {
  const [correlationId, setCorrelationId] = useState("");
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const blob = await downloadAuditReport(correlationId.trim());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `collectiq-audit-${correlationId.trim()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit & Compliance</h1>
      <Card>
        <CardHeader>
          <CardTitle>Downloadable audit report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Exports transition log, adapter lifecycle (including compliance-related audit rows), and collected errors
            for the active tenant.
          </p>
          <input
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
            placeholder="correlationId"
            className="h-10 w-full max-w-md rounded-md border bg-background px-3"
          />
          <Button disabled={!correlationId.trim() || busy} onClick={download}>
            {busy ? "Preparing…" : "Download JSON"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
