"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStoredTenantId, hydrateTenantContextFromServer } from "@/lib/api-client";
import { normalizeExecutionEvent } from "@/lib/execution-event-normalizer";
import { executionStore } from "@/lib/execution-store";
import { recordProjectionLagMs, recordSseDrop, recordSseReconnect } from "@/lib/execution-telemetry";

const DEFAULT_BFF_PREFIX = "/api/collectiq";
const configuredBffPrefix = process.env.NEXT_PUBLIC_COLLECTIQ_BFF_PATH?.trim();
if (configuredBffPrefix && configuredBffPrefix.replace(/\/$/, "") !== DEFAULT_BFF_PREFIX) {
  throw new Error(
    `Invalid NEXT_PUBLIC_COLLECTIQ_BFF_PATH "${configuredBffPrefix}". SSE boundary is locked to ${DEFAULT_BFF_PREFIX}.`,
  );
}
const BFF_PREFIX = DEFAULT_BFF_PREFIX;
const TENANT_HEADER = "x-collectiq-tenant-id";

function parseSseBlocks(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: string[] = [];
  for (const block of parts) {
    const dataLines = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.replace(/^data:\s?/, ""));
    if (dataLines.length === 0) continue;
    const json = dataLines.join("\n").trim();
    if (json) events.push(json);
  }
  return { events, rest };
}

function invalidateStreamTargets(
  qc: ReturnType<typeof useQueryClient>,
  msg: { envelope?: string; correlationId?: string },
) {
  void qc.invalidateQueries({ queryKey: ["execution-active"] });
  void qc.invalidateQueries({ queryKey: ["approvals-pending"] });
  void qc.invalidateQueries({ queryKey: ["payments-pending"] });
  void qc.invalidateQueries({ queryKey: ["campaigns"] });
  void qc.invalidateQueries({ queryKey: ["execution-retries"] });
  void qc.invalidateQueries({ queryKey: ["approval-sla-metrics"] });
  void qc.invalidateQueries({ queryKey: ["observability-summary"] });
  void qc.invalidateQueries({ queryKey: ["observability-stream"] });
  const c = typeof msg.correlationId === "string" ? msg.correlationId.trim() : "";
  if (c) {
    void qc.invalidateQueries({ queryKey: ["case-trace", c] });
  }
  void qc.invalidateQueries({ queryKey: ["case-trace"] });
}

/**
 * Fetch-based SSE via Next.js BFF (`/api/collectiq/...`); API key stays server-side.
 */
export function useEventStream(options: { enabled: boolean; correlationId?: string }) {
  const qc = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);
  const [sseFailed, setSseFailed] = useState(false);
  const [tenantVersion, setTenantVersion] = useState(0);
  const genRef = useRef(0);
  const tenantId = getStoredTenantId()?.trim() ?? "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onTenantChanged = () => {
      setTenantVersion((v) => v + 1);
    };
    window.addEventListener("collectiq-tenant-changed", onTenantChanged as EventListener);
    return () => {
      window.removeEventListener("collectiq-tenant-changed", onTenantChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!options.enabled || typeof window === "undefined") {
      return;
    }
    const gen = ++genRef.current;
    const ac = new AbortController();
    const qs =
      options.correlationId && options.correlationId.trim().length > 0
        ? `?correlationId=${encodeURIComponent(options.correlationId.trim())}`
        : "";
    const url = `${BFF_PREFIX}/api/v1/events/stream${qs}`;

    let buf = "";
    setSseFailed(false);
    setSseConnected(false);

    void (async () => {
      try {
        await hydrateTenantContextFromServer();
        const tenantAfterHydrate = getStoredTenantId()?.trim();
        if (!tenantAfterHydrate) {
          return;
        }
        const headersWithTenant: Record<string, string> = { [TENANT_HEADER]: tenantAfterHydrate };
        recordSseReconnect(tenantAfterHydrate);
        const res = await fetch(url, { headers: headersWithTenant, signal: ac.signal });
        if (!res.ok || !res.body) {
          throw new Error(`stream_http_${res.status}`);
        }
        if (genRef.current !== gen) return;
        setSseConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseBlocks(buf);
          buf = rest;
          for (const raw of events) {
            try {
              const msg = JSON.parse(raw) as {
                schemaVersion?: string;
                envelope?: string;
                correlationId?: string;
                eventType?: string;
              };
              if (msg.envelope === "HEARTBEAT") {
                continue;
              }
              if (
                msg.envelope === "DOMAIN_EVENT" ||
                msg.envelope === "STATE_TRANSITION" ||
                msg.envelope === "WEBHOOK_EVENT"
              ) {
                const normalized = normalizeExecutionEvent(msg);
                if (normalized) {
                  recordProjectionLagMs(Date.now() - normalized.occurredAtMs, normalized.envelope);
                  executionStore.dispatch(normalized);
                } else {
                  recordSseDrop("normalize_rejected");
                }
                invalidateStreamTargets(qc, msg);
              }
            } catch (error) {
              recordSseDrop(
                error instanceof Error && error.message ? `parse_or_normalize:${error.message}` : "parse_or_normalize",
              );
            }
          }
        }
      } catch (error) {
        if (!ac.signal.aborted && genRef.current === gen) {
          recordSseDrop(error instanceof Error && error.message ? `stream_error:${error.message}` : "stream_error");
          setSseFailed(true);
        }
      } finally {
        if (genRef.current === gen && !ac.signal.aborted) {
          setSseConnected(false);
        }
      }
    })();

    return () => {
      ac.abort();
    };
  }, [options.enabled, options.correlationId, qc, tenantId, tenantVersion]);

  return { sseConnected, sseFailed };
}
