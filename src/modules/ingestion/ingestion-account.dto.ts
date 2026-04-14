import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Validates a single ingestion account row (class-validator).
 * Supports legacy `account_number` / `cnic` alongside Phase A `name` requirement.
 */
export class IngestionAccountRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  name?: string;

  @ValidateIf((o: IngestionAccountRowDto) => !o.name || o.name.trim().length === 0)
  @IsString()
  @MaxLength(256)
  account_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cnic?: string;

  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9]{10,15}$/, {
    message: 'phone must be 10–15 digits, optional leading +',
  })
  phone!: string;

  @Transform(({ value }) => (typeof value === 'string' ? Number(value.trim()) : value))
  @IsNumber()
  @Min(0.01, { message: 'amount must be greater than 0' })
  amount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overdue_days?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overdueDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  past_behavior?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pastBehavior?: number;
}
