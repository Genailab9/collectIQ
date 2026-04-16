import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { TransitionReadModelService } from '../read-model/transition-read-model.service';
import { mapControllerError } from '../../lib/errors/error-mapper';
import { OfficerDecisionDto, RegisterApprovalRequestDto } from './approval.dto';
import { ApprovalService } from './approval.service';

@Controller('approvals')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly tenantContext: TenantContextService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  /** Read-model: APPROVAL queue (non-terminal awaiting officer). */
  @Get('pending')
  async pending() {
    try {
      return this.readModel.listPendingApprovals(this.tenantContext.getRequired());
    } catch (error) {
      throw mapControllerError(error);
    }
  }

  /**
   * Latest APPROVAL machine state (transition log only; no projection table).
   */
  @Get(':correlationId/state')
  async getState(@Param('correlationId') correlationId: string) {
    try {
      const t = this.tenantContext.getRequired();
      const c = correlationId?.trim();
      if (!c) {
        throw new BadRequestException('correlationId is required.');
      }
      return this.approvals.getState(t, c);
    } catch (error) {
      throw mapControllerError(error, { correlationId });
    }
  }

  /**
   * Registers a settlement approval request; policy engine selects REQUESTED→APPROVED vs REQUESTED→PENDING.
   */
  @Post('requests')
  @HttpCode(201)
  async registerRequest(@Body() body: RegisterApprovalRequestDto) {
    const correlationId = body.correlationId?.trim() ?? body.correlationId;
    try {
      const correlation = body.correlationId?.trim() ?? '';
      const idempotencyKey = body.idempotencyKey?.trim() ?? '';
      if (!correlation || !idempotencyKey) {
        throw new BadRequestException('correlationId and idempotencyKey are required.');
      }
      return await this.approvals.registerSettlementApprovalRequest({
        tenantId: this.tenantContext.getRequired(),
        correlationId: correlation,
        offerAmountCents: body.offerAmountCents,
        idempotencyKey,
        borrowerOptedOut: body.borrowerOptedOut,
      });
    } catch (error) {
      throw mapControllerError(error, { correlationId });
    }
  }

  /**
   * Officer decision endpoint — emits only valid APPROVAL transitions through SMEK.
   */
  @Post(':correlationId/decisions')
  @HttpCode(200)
  async officerDecision(
    @Param('correlationId') correlationId: string,
    @Body() body: OfficerDecisionDto,
  ) {
    try {
      const c = correlationId?.trim() ?? '';
      const fromState = body.fromState?.trim() ?? '';
      const officerId = body.officerId?.trim() ?? '';
      const idempotencyKey = body.idempotencyKey?.trim() ?? '';
      if (!c || !fromState || !officerId || !idempotencyKey) {
        throw new BadRequestException(
          'correlationId, fromState, officerId, and idempotencyKey are required.',
        );
      }
      return await this.approvals.submitOfficerDecision({
        tenantId: this.tenantContext.getRequired(),
        correlationId: c,
        fromState,
        decision: body.decision,
        officerId,
        idempotencyKey,
        counterOfferAmountCents: body.counterOfferAmountCents,
      });
    } catch (error) {
      throw mapControllerError(error, { correlationId });
    }
  }
}
