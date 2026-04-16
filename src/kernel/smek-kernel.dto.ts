import type { AdapterEnvelope } from '../contracts/adapter-envelope';
import type { ApprovalPolicyRoute } from '../contracts/approval-policy.types';
import type { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import type { ComplianceGateInput } from '../compliance/compliance.types';
import type { TransitionProposal } from '../state-machine/types/transition-proposal';

export type TelephonyIngressSource =
  | 'TWILIO_VOICE_STATUS'
  | 'INTERNAL_AUTH_CHECKPOINT'
  | 'INTERNAL_NEGOTIATION_COMPLETE'
  | 'INTERNAL_COUNTER_OFFER';

export interface TelephonyIngressContext {
  readonly source: TelephonyIngressSource;
}

export type ApprovalIngressSource = 'INTERNAL_POLICY' | 'OFFICER_API' | 'ESCALATION_TIMER';

export interface ApprovalIngressContext {
  readonly source: ApprovalIngressSource;
}

export type PaymentIngressSource = 'GATEWAY_WEBHOOK' | 'INTERNAL_BOOTSTRAP';

export interface PaymentIngressContext {
  readonly source: PaymentIngressSource;
}

/**
 * Internal-only SYNC ingress (no outbound sync adapter on these edges).
 * - `POST_PAYMENT_SUCCESS`: bootstrap NOT_STARTED→IN_FLIGHT.
 * - `SYNC_CASE_CLOSURE`: terminal `sync.completed` edge CASE_FINALIZED→COMPLETED (strict loop).
 */
export type SyncIngressSource = 'POST_PAYMENT_SUCCESS' | 'SYNC_CASE_CLOSURE';

export interface SyncIngressContext {
  readonly source: SyncIngressSource;
}

/** When set, SMEK runs `ApprovalAdapter.evaluateApproval` before validation and uses the suggested `to` state. */
export interface ApprovalPolicyEvaluationInput {
  readonly offerAmountCents: number;
}

/** PRD v1.1 §11.2 — SMEK returns this outcome when compliance blocks (no transition log, no adapters). */
export const SMEK_OUTCOME = {
  COMPLETED: 'COMPLETED',
  COMPLIANCE_BLOCKED: 'COMPLIANCE_BLOCKED',
} as const;

export type SmekOutcome = (typeof SMEK_OUTCOME)[keyof typeof SMEK_OUTCOME];

interface SmekLoopResultBase {
  readonly phase: ExecutionLoopPhase;
  readonly tenantId: string;
  readonly correlationId: string;
}

export interface SmekLoopCompletedResult extends SmekLoopResultBase {
  readonly outcome: typeof SMEK_OUTCOME.COMPLETED;
  readonly adapterResult: unknown | undefined;
  /** Present when `approvalPolicyEvaluation` was honored on this loop (settlement registration). */
  readonly resolvedApprovalPolicy?: { readonly route: ApprovalPolicyRoute };
}

export interface SmekLoopComplianceBlockedResult extends SmekLoopResultBase {
  readonly outcome: typeof SMEK_OUTCOME.COMPLIANCE_BLOCKED;
  readonly blockCode: string;
  readonly message: string;
}

export type SmekLoopResult = SmekLoopCompletedResult | SmekLoopComplianceBlockedResult;

export function isSmekComplianceBlocked(
  result: SmekLoopResult,
): result is SmekLoopComplianceBlockedResult {
  return result.outcome === SMEK_OUTCOME.COMPLIANCE_BLOCKED;
}

export interface SmekLoopCommand {
  readonly phase: ExecutionLoopPhase;
  readonly transition: TransitionProposal;
  readonly adapterEnvelope: AdapterEnvelope | null;
  readonly complianceGate: ComplianceGateInput;
  /**
   * Provider ingress path: allows telephony lifecycle transitions without an outbound adapter invocation.
   */
  readonly telephonyIngress?: TelephonyIngressContext;
  /**
   * Internal approval path: allows APPROVE-phase transitions without the external approval adapter.
   */
  readonly approvalIngress?: ApprovalIngressContext;
  /**
   * Payment path without outbound payment port (e.g. PRD v1.1 bootstrap ALTERNATE_METHOD→INITIATED, or gateway webhook-only confirms).
   */
  readonly paymentIngress?: PaymentIngressContext;
  /**
   * Post-payment sync scheduling: logs bootstrap SYNC transition without outbound sync adapter (adapter runs on the next edge).
   */
  readonly syncIngress?: SyncIngressContext;
  /** PRD v1.1 §7.1 — policy evaluation is invoked inside SMEK before the transition is validated and logged. */
  readonly approvalPolicyEvaluation?: ApprovalPolicyEvaluationInput;
  /** PRD v1.2 §2 — optional per-loop idempotency (payments, approvals, webhooks, execution APIs). */
  readonly idempotency?: {
    readonly key: string;
    readonly step: string;
  };
}
