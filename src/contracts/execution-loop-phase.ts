/**
 * Canonical CollectIQ execution sequence (PRD §1.2, §3.1).
 * SMEK never infers the next phase; callers supply the active phase per invocation.
 */
export enum ExecutionLoopPhase {
  DATA = 'DATA',
  CALL = 'CALL',
  AUTHENTICATE = 'AUTHENTICATE',
  NEGOTIATE = 'NEGOTIATE',
  APPROVE = 'APPROVE',
  PAY = 'PAY',
  SYNC = 'SYNC',
}
