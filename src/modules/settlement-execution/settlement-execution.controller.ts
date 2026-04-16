import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { mapControllerError } from '../../lib/errors/error-mapper';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { TransitionReadModelService } from '../read-model/transition-read-model.service';
import { SettlementExecutionService } from './settlement-execution.service';

class CorrelationBodyDto {
  @IsString()
  correlationId!: string;

  @IsString()
  idempotencyKey!: string;

  @IsOptional()
  @IsBoolean()
  borrowerOptedOut?: boolean;
}

class NegotiateBodyDto extends CorrelationBodyDto {
  @IsString()
  conversationTranscript!: string;

  @IsOptional()
  @IsString()
  accountFacts?: string;
}

class ExecutionRetriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * PRD v1.1 §6.2 / PRD v1.2 §4 — CALL…SYNC gated steps; DATA ingestion is `POST /ingestion/upload` only.
 * Call lifecycle webhooks remain on `/webhooks/telephony/twilio/voice/status`.
 * PRD §16 — execution API key is enforced by `PrdSecurityMiddleware` (not per-controller guards).
 */
@Controller(['execution', 'api/v1/execution'])
export class SettlementExecutionController {
  constructor(
    private readonly execution: SettlementExecutionService,
    private readonly tenantContext: TenantContextService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  @Get('retries')
  async retries(@Query() query: ExecutionRetriesQueryDto) {
    try {
      return this.readModel.listExecutionRetries(this.tenantContext.getRequired(), {
        limit: query.limit,
        offset: query.offset,
      });
    } catch (error) {
      throw mapControllerError(error);
    }
  }

  @Get('active')
  async active() {
    try {
      return this.readModel.listActiveExecutions(this.tenantContext.getRequired());
    } catch (error) {
      throw mapControllerError(error);
    }
  }

  @Post('call/authenticate')
  @HttpCode(204)
  async authenticate(@Body() body: CorrelationBodyDto): Promise<void> {
    try {
      await this.execution.authenticateCall({
        tenantId: this.tenantContext.getRequired(),
        correlationId: body.correlationId,
        idempotencyKey: body.idempotencyKey,
        borrowerOptedOut: body.borrowerOptedOut,
      });
    } catch (error) {
      throw mapControllerError(error, { correlationId: body.correlationId });
    }
  }

  @Post('call/negotiate')
  @HttpCode(200)
  async negotiate(@Body() body: NegotiateBodyDto): Promise<unknown> {
    try {
      return await this.execution.negotiate({
        tenantId: this.tenantContext.getRequired(),
        correlationId: body.correlationId,
        conversationTranscript: body.conversationTranscript,
        accountFacts: body.accountFacts,
        idempotencyKey: body.idempotencyKey,
        borrowerOptedOut: body.borrowerOptedOut,
      });
    } catch (error) {
      throw mapControllerError(error, { correlationId: body.correlationId });
    }
  }

  @Post('call/submit-for-approval')
  @HttpCode(204)
  async submitForApproval(@Body() body: CorrelationBodyDto): Promise<void> {
    try {
      await this.execution.submitCallForApproval({
        tenantId: this.tenantContext.getRequired(),
        correlationId: body.correlationId,
        idempotencyKey: body.idempotencyKey,
        borrowerOptedOut: body.borrowerOptedOut,
      });
    } catch (error) {
      throw mapControllerError(error, { correlationId: body.correlationId });
    }
  }
}
