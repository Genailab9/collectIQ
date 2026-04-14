/**
 * PRD v1.1 §12.1 — SMEK orchestration audit rows are **output only** (observability / replay).
 * §12.2 FORBIDDEN: any listener, queue consumer, or cron that mutates business state or calls `executeLoop`
 * in reaction to these rows (or to “domain events” derived from them).
 */
export const SMEK_ORCHESTRATION_AUDIT_KIND = {
  /** Append-only record emitted after a completed SMEK loop (transition logged + adapters invoked as applicable). */
  LoopOutput: 'KERNEL_LOOP_OUTPUT',
  /** Adapter invocation started (before outbound call). */
  AdapterStart: 'KERNEL_ADAPTER_START',
  /** Adapter invocation completed successfully. */
  AdapterSuccess: 'KERNEL_ADAPTER_SUCCESS',
  /** Structured capture of adapter return payloads for operational bridges (e.g. gateway id resolution). */
  AdapterResult: 'KERNEL_ADAPTER_RESULT',
  /** Adapter invocation failed (error snapshot persisted before throw). */
  AdapterError: 'KERNEL_ADAPTER_ERROR',
} as const;

export type SmekOrchestrationAuditKind =
  (typeof SMEK_ORCHESTRATION_AUDIT_KIND)[keyof typeof SMEK_ORCHESTRATION_AUDIT_KIND];
