export type ApprovalPolicyRoute = 'AUTO_APPROVE' | 'MANUAL_REVIEW';

/** Result of approval policy evaluation (PRD v1.1 §7) — produced only via `ApprovalAdapter.evaluateApproval` inside SMEK. */
export interface ApprovalPolicyAdapterResult {
  readonly route: ApprovalPolicyRoute;
  readonly toState: string;
  readonly escalationDeadlineAtIso: string | null;
}
