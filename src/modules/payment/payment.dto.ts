import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsString()
  idempotencyKey!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  /** PRD v1.1 §8.3 — must already be APPROVED on the APPROVAL machine. */
  @IsString()
  approvalCorrelationId!: string;

  @IsOptional()
  @IsBoolean()
  borrowerOptedOut?: boolean;
}

export class ConfirmPaymentDto {
  @IsString()
  gatewayPaymentIntentId!: string;

  /** PRD v1.2 §2 — scopes confirm + post-payment sync SMEK loops. */
  @IsString()
  idempotencyKey!: string;

  @IsOptional()
  @IsBoolean()
  borrowerOptedOut?: boolean;
}
