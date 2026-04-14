"use client";

import { ChangeEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listCampaignsApi, uploadIngestionFile } from "@/lib/api-client";
import { computePriority } from "@/lib/campaign-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";

type UploadResult = {
  accepted: Array<{ index: number; correlation_id: string; record_id: string }>;
  rejected: Array<{ index: number; reason: string }>;
};

type RowValidationError = {
  index: number;
  messages: string[];
};

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });
    return row;
  });
}

function IngestionContent() {
  const searchParams = useSearchParams();
  const campaignIdFromUrl = searchParams.get("campaignId")?.trim() ?? "";

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaignsApi(),
    refetchInterval: 60_000,
  });

  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  /** Manual pick wins over URL so operators can switch campaigns without leaving the page. */
  const effectiveCampaignId = (selectedCampaignId.trim() || campaignIdFromUrl).trim();

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<RowValidationError[]>([]);
  const { showToast } = useToast();

  const headers = useMemo(() => Object.keys(rows[0] ?? {}), [rows]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const campaignId = effectiveCampaignId.trim();
      if (!campaignId) {
        throw new Error("Select a campaign before uploading.");
      }
      const data = await uploadIngestionFile({
        campaignId,
        accounts: rows.map((row) => {
          const amount = Number(row.amount) || 0;
          const overdueDays = Number(row.overdue_days || row.overdueDays || 0) || 0;
          const pastBehaviorScore = Number(row.past_behavior || row.pastBehavior || 0) || 0;
          const priority = computePriority({ amountCents: amount, overdueDays, pastBehaviorScore });
          return {
            ...row,
            priorityScore: priority.score,
            priorityLabel: priority.label,
          };
        }),
      });
      return { data, campaignId };
    },
    onSuccess: ({ data }) => {
      setUploadResult(data);
      showToast({
        title: "Ingestion upload completed",
        description: `${data.accepted.length} accepted, ${data.rejected.length} rejected`,
        variant: "success",
      });
    },
    onError: (error) => {
      setUploadResult(null);
      showToast({
        title: "Ingestion upload failed",
        description: (error as { message?: string })?.message ?? "Upload failed.",
        variant: "error",
      });
    },
  });

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    const parsedRows = parseCsv(text);
    const errors: RowValidationError[] = [];
    parsedRows.forEach((row, index) => {
      const messages: string[] = [];
      if (!row.name?.trim()) {
        messages.push("name is required");
      }
      if (!row.phone?.trim()) {
        messages.push("phone is required");
      }
      const amount = Number(row.amount);
      if (!row.amount?.trim() || !Number.isFinite(amount) || amount <= 0) {
        messages.push("amount must be a positive number");
      }
      if (messages.length > 0) {
        errors.push({ index, messages });
      }
    });
    setFileName(file.name);
    setRows(parsedRows);
    setUploadResult(null);
    setValidationErrors(errors);
  };

  const canSubmit =
    rows.length > 0 &&
    validationErrors.length === 0 &&
    effectiveCampaignId.length > 0 &&
    !uploadMutation.isPending;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Ingestion</h1>
      <p className="text-sm text-muted-foreground">
        Choose the campaign this upload belongs to, then submit your CSV. Create campaigns on the{" "}
        <Link href="/campaigns" className="underline">
          campaigns
        </Link>{" "}
        page first.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Campaign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {campaignIdFromUrl ? (
            <p className="text-muted-foreground">
              URL campaign id detected. You can change it below before uploading.
            </p>
          ) : null}
          <label className="block text-muted-foreground">
            Active campaign (required)
            <select
              className="mt-1 h-10 w-full max-w-xl rounded-md border bg-background px-3"
              value={effectiveCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
            >
              <option value="">Select a campaign…</option>
              {(campaignsQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </label>
          {!effectiveCampaignId ? (
            <p className="text-amber-800 dark:text-amber-200">
              Select a campaign before uploading.{" "}
              <Link href="/campaigns" className="underline">
                Go to campaigns
              </Link>
            </p>
          ) : null}
          {campaignsQuery.isError ? (
            <p className="text-destructive">
              {(campaignsQuery.error as { message?: string })?.message ?? "Could not load campaigns."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload borrower CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="block w-full text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {fileName
                ? `Loaded file: ${fileName}`
                : "Upload CSV with required columns: name, phone, amount (plus cnic / account fields per backend rules)."}
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="text-sm text-muted-foreground">Rows ready: {rows.length}</div>
            <Button disabled={!canSubmit} onClick={() => uploadMutation.mutate()}>
              {uploadMutation.isPending ? "Submitting…" : "Submit to API"}
            </Button>
          </div>
          {validationErrors.length > 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">Validation errors</p>
              <div className="mt-2 space-y-1 text-xs">
                {validationErrors.slice(0, 10).map((err) => (
                  <div key={err.index}>
                    Row {err.index}: {err.messages.join(", ")}
                  </div>
                ))}
              </div>
              {validationErrors.length > 10 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing first 10 of {validationErrors.length} invalid rows.
                </p>
              ) : null}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">Preview rows</h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      {headers.map((header) => (
                        <th key={header} className="px-3 py-2 font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-t">
                        {headers.map((header) => (
                          <td key={`${idx}-${header}`} className="px-3 py-2">
                            {row[header] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 10 ? (
                <p className="text-xs text-muted-foreground">Showing first 10 rows of {rows.length}.</p>
              ) : null}
            </div>
          ) : null}

          {uploadMutation.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">
                {(uploadMutation.error as { message?: string })?.message ?? "Upload failed."}
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => uploadMutation.mutate()}>
                Retry submit
              </Button>
            </div>
          ) : null}

          {uploadResult ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-md border p-3">
                <h3 className="text-sm font-medium">Accepted</h3>
                {uploadResult.accepted.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No successful rows.</p>
                ) : (
                  <div className="space-y-1 text-sm">
                    {uploadResult.accepted.map((row) => (
                      <div key={`${row.index}-${row.record_id}`} className="rounded bg-emerald-50 px-2 py-1 dark:bg-emerald-950/40">
                        row {row.index}: record {row.record_id}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <h3 className="text-sm font-medium">Rejected</h3>
                {uploadResult.rejected.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No failed rows.</p>
                ) : (
                  <div className="space-y-1 text-sm">
                    {uploadResult.rejected.map((row) => (
                      <div key={`${row.index}-${row.reason}`} className="rounded bg-red-50 px-2 py-1 dark:bg-red-950/40">
                        row {row.index}: {row.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function IngestionPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Ingestion</h1>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <IngestionContent />
    </Suspense>
  );
}
