import type { OfficerDecisionType } from './approval.types';

export class RegisterApprovalRequestDto {
  correlationId!: string;
  /** Settlement offer amount in integer cents. */
  offerAmountCents!: number;
  /** PRD v1.2 §2 — scopes SMEK register loop. */
  idempotencyKey!: string;
  borrowerOptedOut?: boolean;
}

export class OfficerDecisionDto {
  /** Must match the latest APPROVAL machine state from GET /state. */
  fromState!: string;
  decision!: OfficerDecisionType;
  officerId!: string;
  idempotencyKey!: string;
}
