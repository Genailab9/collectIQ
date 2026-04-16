#!/usr/bin/env node
/**
 * Chaos certification pack for CollectIQ.
 *
 * Usage:
 *   npm run chaos:test -- --scenario=payment-burst --tenant=tenant_a --api-key=... --base-url=http://localhost:3000
 *
 * Scenarios:
 *   - payment-burst
 *   - approval-timeout-wave
 *   - webhook-duplication-storm
 *   - webhook-out-of-order-replay
 *   - adapter-partial-failure-loop
 *   - mixed-chaos
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [k, v] = raw.slice(2).split("=", 2);
    out[k] = v ?? "true";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const scenario = String(args.scenario ?? "payment-burst").trim();
const baseUrl = String(args["base-url"] ?? process.env.CHAOS_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const tenantId = String(args.tenant ?? process.env.CHAOS_TENANT_ID ?? "").trim();
const apiKey = String(args["api-key"] ?? process.env.CHAOS_API_KEY ?? "").trim();
const adminKey = String(args["admin-key"] ?? process.env.CHAOS_ADMIN_KEY ?? "").trim();
const durationSec = Number.parseInt(String(args.duration ?? process.env.CHAOS_DURATION_SECONDS ?? "45"), 10);
const pollMs = Number.parseInt(String(args["poll-ms"] ?? process.env.CHAOS_POLL_MS ?? "3000"), 10);
const outPath = String(args.out ?? process.env.CHAOS_REPORT_PATH ?? `chaos-report-${scenario}-${Date.now()}.json`);

if (!tenantId) {
  throw new Error("Missing tenant id. Provide --tenant=<id> or CHAOS_TENANT_ID.");
}
if (!apiKey) {
  throw new Error("Missing API key. Provide --api-key=<key> or CHAOS_API_KEY.");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function http(method, path, { tenantScoped = true, body, extraHeaders } = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-CollectIQ-Api-Key": apiKey,
    ...(tenantScoped ? { "X-CollectIQ-Tenant-Id": tenantId } : {}),
    ...(extraHeaders ?? {}),
  };
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchMetricsText() {
  const res = await fetch(`${baseUrl}/metrics`);
  if (!res.ok) {
    throw new Error(`GET /metrics failed: ${res.status}`);
  }
  return res.text();
}

function parseMetricSum(text, metricName) {
  let sum = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.startsWith(metricName)) continue;
    if (line.startsWith(`#`)) continue;
    const valueRaw = line.split(" ").pop();
    const num = Number.parseFloat(String(valueRaw ?? "0"));
    if (Number.isFinite(num)) sum += num;
  }
  return sum;
}

async function setSimulationFlags(flags) {
  return http("POST", "/api/v1/system/simulation", {
    body: flags,
    tenantScoped: true,
  });
}

async function triggerRecovery() {
  if (!adminKey) return { skipped: true, reason: "no_admin_key" };
  return http("POST", "/saas/admin/recovery/trigger", {
    tenantScoped: false,
    extraHeaders: { "X-CollectIQ-Admin-Key": adminKey, "X-CollectIQ-Admin-Actor": "chaos-pack" },
  });
}

async function snapshot() {
  const [metricsText, retries, active, domainEvents, approvalsSla] = await Promise.all([
    fetchMetricsText(),
    http("GET", "/api/v1/execution/retries?limit=500&offset=0"),
    http("GET", "/api/v1/execution/active"),
    http("GET", "/api/v1/observability/domain-events?limit=200"),
    http("GET", "/api/v1/analytics/approvals"),
  ]);
  const events = Array.isArray(domainEvents?.events) ? domainEvents.events : [];
  const duplicateDomainEvents = (() => {
    const seen = new Set();
    let dup = 0;
    for (const ev of events) {
      const id = String(ev?.eventId ?? "");
      if (!id) continue;
      if (seen.has(id)) dup += 1;
      seen.add(id);
    }
    return dup;
  })();
  const crossTenantLeak = events.some((ev) => String(ev?.tenantId ?? "").trim() !== tenantId);
  const maxRetryCount = Array.isArray(retries)
    ? retries.reduce((m, r) => Math.max(m, Number(r?.retryCount ?? 0)), 0)
    : 0;
  return {
    at: new Date().toISOString(),
    activeCount: Array.isArray(active) ? active.length : 0,
    retryCount: Array.isArray(retries) ? retries.length : 0,
    maxRetryCount,
    domainEventCount: events.length,
    duplicateDomainEvents,
    crossTenantLeak,
    approvalsSla,
    metrics: {
      logsDropped: parseMetricSum(metricsText, "collectiq_logs_dropped_total"),
      logsWritten: parseMetricSum(metricsText, "collectiq_logs_written_total"),
      ssePublished: parseMetricSum(metricsText, "collectiq_sse_events_published_total"),
      traceSummaryReq: parseMetricSum(metricsText, "collectiq_trace_summary_requests_total"),
      traceFullReq: parseMetricSum(metricsText, "collectiq_trace_full_requests_total"),
      traceCacheHit: parseMetricSum(metricsText, "collectiq_trace_summary_cache_hits_total"),
      traceCacheMiss: parseMetricSum(metricsText, "collectiq_trace_summary_cache_miss_total"),
    },
  };
}

function scenarioFlags(name) {
  switch (name) {
    case "payment-burst":
      return { simulatePaymentFailure: true, simulateApprovalTimeout: false, simulateCallFailure: false };
    case "approval-timeout-wave":
      return { simulatePaymentFailure: false, simulateApprovalTimeout: true, simulateCallFailure: false };
    case "webhook-duplication-storm":
      return { simulatePaymentFailure: false, simulateApprovalTimeout: false, simulateCallFailure: false };
    case "webhook-out-of-order-replay":
      return { simulatePaymentFailure: false, simulateApprovalTimeout: false, simulateCallFailure: false };
    case "adapter-partial-failure-loop":
      return { simulatePaymentFailure: true, simulateApprovalTimeout: false, simulateCallFailure: false };
    case "mixed-chaos":
      return { simulatePaymentFailure: true, simulateApprovalTimeout: true, simulateCallFailure: true };
    default:
      throw new Error(`Unknown scenario "${name}"`);
  }
}

async function runScenario() {
  const start = Date.now();
  const before = await snapshot();
  const flags = scenarioFlags(scenario);
  await setSimulationFlags(flags);

  const probes = [];
  let recoveryAttempts = 0;
  const endAt = Date.now() + Math.max(5, durationSec) * 1000;
  while (Date.now() < endAt) {
    if (
      scenario === "webhook-duplication-storm" ||
      scenario === "webhook-out-of-order-replay" ||
      scenario === "adapter-partial-failure-loop" ||
      scenario === "mixed-chaos"
    ) {
      // best-effort replay trigger path (admin plane)
      // no-op when admin key is not provided
      await triggerRecovery();
      recoveryAttempts += 1;
    }
    probes.push(await snapshot());
    await sleep(Math.max(500, pollMs));
  }

  await setSimulationFlags({
    simulatePaymentFailure: false,
    simulateApprovalTimeout: false,
    simulateCallFailure: false,
  });
  const after = await snapshot();
  const durationMs = Date.now() - start;

  const deltas = {
    logsDropped: after.metrics.logsDropped - before.metrics.logsDropped,
    logsWritten: after.metrics.logsWritten - before.metrics.logsWritten,
    ssePublished: after.metrics.ssePublished - before.metrics.ssePublished,
    traceSummaryReq: after.metrics.traceSummaryReq - before.metrics.traceSummaryReq,
    traceFullReq: after.metrics.traceFullReq - before.metrics.traceFullReq,
    traceCacheHit: after.metrics.traceCacheHit - before.metrics.traceCacheHit,
    traceCacheMiss: after.metrics.traceCacheMiss - before.metrics.traceCacheMiss,
    retryBacklog: after.retryCount - before.retryCount,
    activeBacklog: after.activeCount - before.activeCount,
    domainEvents: after.domainEventCount - before.domainEventCount,
  };

  const invariants = {
    noDuplicateDomainEvents: after.duplicateDomainEvents === 0,
    noCrossTenantLeak: after.crossTenantLeak === false,
    boundedRetries: after.maxRetryCount < 25,
    noExplosiveBacklog: deltas.activeBacklog < 200,
  };

  const expected = {
    noDuplicateDomainEvents: true,
    noCrossTenantLeak: true,
    boundedRetries: true,
    noExplosiveBacklog: true,
  };

  const status =
    Object.entries(invariants).every(([k, v]) => v === expected[k])
      ? "PASS"
      : Object.entries(invariants).some(([k, v]) => expected[k] && !v)
        ? "FAIL"
        : "WARNING";

  return {
    scenario,
    status,
    startedAt: new Date(start).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    config: {
      baseUrl,
      tenantId,
      durationSec,
      pollMs,
      flags,
      recoveryAttempts,
    },
    before,
    after,
    deltas,
    invariants,
    expectations: expected,
    probes,
    notes: [
      "This certification validates API-visible invariants and platform counters.",
      "For webhook-duplication scenarios, provide --admin-key to trigger recovery replay path.",
      "For strict certification, run with representative load and production-like Redis.",
    ],
  };
}

const report = await runScenario();
const absoluteOut = resolve(process.cwd(), outPath);
writeFileSync(absoluteOut, JSON.stringify(report, null, 2), "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, scenario, status: report.status, report: absoluteOut })}\n`);
