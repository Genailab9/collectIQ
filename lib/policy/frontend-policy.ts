"use client";

import type { EventStreamState } from "@/lib/event-stream-context";
import contract from "@/config/policy-client-contract.json";

/**
 * Frontend policy mirror for deterministic rendering decisions only.
 * It reflects backend/runtime truth signals and must not hold business authorization logic.
 */
export function canUsePollingFallback(stream: EventStreamState, hasActiveCorrelationId: boolean): boolean {
  return hasActiveCorrelationId && (stream.sseFailed || !stream.sseConnected);
}

export function getFrontendMetricSinkPath(): string {
  return String(contract.frontendMetricSinkPath ?? "/api/collectiq/api/v1/metrics/frontend").trim();
}

export function isProtectedPolicyFlag(flag: string): boolean {
  const f = flag.trim().toUpperCase();
  return Array.isArray(contract.protectedFlags)
    ? contract.protectedFlags.map((v) => String(v).trim().toUpperCase()).includes(f)
    : false;
}

export function canUseFullTraceMode(input: {
  role?: string | null;
  flags?: Record<string, unknown> | null;
  debugHeaderPresent: boolean;
}): boolean {
  const role = String(input.role ?? "").trim().toUpperCase();
  const roles = Array.isArray(contract.traceAccess?.actorRoles)
    ? contract.traceAccess.actorRoles.map((r) => String(r).trim().toUpperCase())
    : [];
  const allowRole = roles.includes(role);
  const tenantFlagKey = String(contract.traceAccess?.tenantFlag ?? "").trim();
  const killSwitchKey = String(contract.traceAccess?.killSwitch ?? "").trim();
  const requireDebugHeader = Boolean(contract.traceAccess?.requireDebugHeader);
  const flags = input.flags ?? {};
  const tenantFlagEnabled = tenantFlagKey
    ? flags[tenantFlagKey] === true || flags[tenantFlagKey] === "true" || flags[tenantFlagKey] === 1
    : true;
  const killSwitchEnabled = killSwitchKey
    ? flags[killSwitchKey] === true || flags[killSwitchKey] === "true" || flags[killSwitchKey] === 1
    : false;
  if (killSwitchEnabled) {
    return false;
  }
  if (!allowRole || !tenantFlagEnabled) {
    return false;
  }
  if (requireDebugHeader && !input.debugHeaderPresent) {
    return false;
  }
  return true;
}
