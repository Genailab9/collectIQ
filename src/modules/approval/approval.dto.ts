import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { OfficerDecisionType } from './approval.types';

export class RegisterApprovalRequestDto {
  @IsString()
  correlationId!: string;

  /** Settlement offer amount in integer cents. */
  @IsInt()
  @Min(1)
  offerAmountCents!: number;

  /** PRD v1.2 §2 — scopes SMEK register loop. */
  @IsString()
  idempotencyKey!: string;

  @IsOptional()
  @IsBoolean()
  borrowerOptedOut?: boolean;
}

export class OfficerDecisionDto {
  /** Must match the latest APPROVAL machine state from GET /state. */
  @IsString()
  fromState!: string;

  @IsString()
  @IsIn(['APPROVE', 'REJECT', 'COUNTER'])
  decision!: OfficerDecisionType;

  @IsString()
  officerId!: string;

  @IsString()
  idempotencyKey!: string;

  /** Required when decision=COUNTER (integer cents). */
  @IsOptional()
  @IsInt()
  @Min(1)
  counterOfferAmountCents?: number;
}
