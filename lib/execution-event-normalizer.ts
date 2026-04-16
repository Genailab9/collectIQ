"use client";

import type { NormalizedExecutionEvent, StreamEnvelope } from "@/lib/execution-store";
import schemaContract from "@/contracts/frontend-execution-schema.contract.json";

type RawStreamEvent = {
  schemaVersion?: unknown;
  envelope?: unknown;
  tenantId?: unknown;
  correlationId?: unknown;
  machine?: unknown;
  from?: unknown;
  to?: unknown;
  provider?: unknown;
  kind?: unknown;
  outcome?: unknown;
  eventType?: unknown;
  payload?: unknown;
};

const EXPECTED_SCHEMA_MAJOR = Number(schemaContract.streamSchema.acceptedMajor);
const ACCEPTED_SCHEMA_MINORS = new Set(
  (schemaContract.streamSchema.acceptedMinors ?? [])
    .map((v) => String(v).trim())
    .filter((v) => /^\d+\.\d+$/.test(v)),
);

function isEnvelope(value: string): value is StreamEnvelope {
  return value === "DOMAIN_EVENT" || value === "STATE_TRANSITION" || value === "WEBHOOK_EVENT";
}

function isSchemaVersionAccepted(raw: unknown): boolean {
  const schemaVersion = String(raw ?? "").trim();
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(schemaVersion);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || major !== EXPECTED_SCHEMA_MAJOR) {
    return false;
  }
  const majorMinor = `${major}.${minor}`;
  if (ACCEPTED_SCHEMA_MINORS.size === 0) {
    return true;
  }
  return ACCEPTED_SCHEMA_MINORS.has(majorMinor);
}

export function normalizeExecutionEvent(raw: unknown): NormalizedExecutionEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as RawStreamEvent;
  if (!isSchemaVersionAccepted(event.schemaVersion)) return null;
  const envelope = String(event.envelope ?? "").trim();
  if (!isEnvelope(envelope)) return null;
  const tenantId = String(event.tenantId ?? "").trim();
  const correlationId = String(event.correlationId ?? "").trim();
  if (!tenantId || !correlationId) return null;
  const payloadObj =
    event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const backendTsRaw =
    payloadObj.timestamp ??
    payloadObj.occurredAt ??
    (event as unknown as Record<string, unknown>).timestamp ??
    (event as unknown as Record<string, unknown>).occurredAt;
  if (typeof backendTsRaw !== "string" || !backendTsRaw.trim()) {
    throw new Error("Missing event timestamp");
  }
  const occurredAtMs = Date.parse(backendTsRaw);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error("Invalid event timestamp");
  }

  if (envelope === "STATE_TRANSITION") {
    const machine = String(event.machine ?? "").trim();
    const from = String(event.from ?? "").trim();
    const to = String(event.to ?? "").trim();
    if (!machine || !from || !to) return null;
    return {
      envelope,
      tenantId,
      correlationId,
      occurredAtMs,
      payload: {
        machine,
        from,
        to,
      },
    };
  }
  if (envelope === "WEBHOOK_EVENT") {
    const provider = String(event.provider ?? "").trim();
    const kind = String(event.kind ?? "").trim();
    const outcome = String(event.outcome ?? "").trim();
    if (!provider || !kind || !outcome) return null;
    return {
      envelope,
      tenantId,
      correlationId,
      occurredAtMs,
      payload: {
        provider,
        kind,
        outcome,
      },
    };
  }
  const eventType = String(event.eventType ?? "").trim();
  if (!eventType) return null;
  return {
    envelope,
    tenantId,
    correlationId,
    occurredAtMs,
    payload: {
      eventType,
      payload: payloadObj,
    },
  };
}
