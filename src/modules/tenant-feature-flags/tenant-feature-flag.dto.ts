import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const ALLOWED_KEYS = ['SIMULATE_CALLS', 'FORCE_PAYMENT_SUCCESS', 'DEMO_MODE'] as const;

export class UpsertTenantFeatureFlagDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...ALLOWED_KEYS])
  @MaxLength(128)
  key!: (typeof ALLOWED_KEYS)[number];

  /** boolean | string | number | object — stored as JSON */
  @IsNotEmpty()
  value!: unknown;
}
