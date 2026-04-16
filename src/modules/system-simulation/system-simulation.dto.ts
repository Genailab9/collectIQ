import { IsBoolean, IsOptional } from 'class-validator';

export class SystemSimulationDto {
  @IsOptional()
  @IsBoolean()
  simulatePaymentFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  simulateApprovalTimeout?: boolean;

  @IsOptional()
  @IsBoolean()
  simulateCallFailure?: boolean;
}
