import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { TransitionReadModelService } from '../read-model/transition-read-model.service';
import { SettlementExecutionService } from './settlement-execution.service';

class CorrelationBodyDto {
  correlationId!: string;
  idempotencyKey!: string;
  borrowerOptedOut?: boolean;
}

class NegotiateBodyDto extends CorrelationBodyDto {
  conversationTranscript!: string;
  accountFacts?: string;
}

/**
 * PRD v1.1 §6.2 / PRD v1.2 §4 — CALL…SYNC gated steps; DATA ingestion is `POST /ingestion/upload` only.
 * Call lifecycle webhooks remain on `/webhooks/telephony/twilio/voice/status`.
 * PRD §16 — execution API key is enforced by `PrdSecurityMiddleware` (not per-controller guards).
 */
@Controller('execution')
export class SettlementExecutionController {
  constructor(
    private readonly execution: SettlementExecutionService,
    private readonly tenantContext: TenantContextService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  @Get('active')
  async active() {
    return this.readModel.listActiveExecutions(this.tenantContext.getRequired());
  }

  @Post('call/authenticate')
  @HttpCode(204)
  async authenticate(@Body() body: CorrelationBodyDto): Promise<void> {
    await this.execution.authenticateCall({
      tenantId: this.tenantContext.getRequired(),
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      borrowerOptedOut: body.borrowerOptedOut,
    });
  }

  @Post('call/negotiate')
  @HttpCode(200)
  async negotiate(@Body() body: NegotiateBodyDto): Promise<unknown> {
    return this.execution.negotiate({
      tenantId: this.tenantContext.getRequired(),
      correlationId: body.correlationId,
      conversationTranscript: body.conversationTranscript,
      accountFacts: body.accountFacts,
      idempotencyKey: body.idempotencyKey,
      borrowerOptedOut: body.borrowerOptedOut,
    });
  }

  @Post('call/submit-for-approval')
  @HttpCode(204)
  async submitForApproval(@Body() body: CorrelationBodyDto): Promise<void> {
    await this.execution.submitCallForApproval({
      tenantId: this.tenantContext.getRequired(),
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      borrowerOptedOut: body.borrowerOptedOut,
    });
  }
}
