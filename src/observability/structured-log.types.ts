/**
 * PRD §12 — every structured log line MUST include these fields (use `n/a` when not applicable).
 */
export interface StructuredLogEvent {
  readonly level?: 'info' | 'warn' | 'error';
  readonly timestamp?: string;
  readonly at?: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly phase: string;
  readonly state: string;
  readonly adapter: string;
  readonly result: string;
  readonly surface?: string;
  readonly message?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly circuitKey?: string;
}
