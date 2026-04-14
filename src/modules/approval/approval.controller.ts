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
    return this.readModel.listPendingApprovals(this.tenantContext.getRequired());
  }

  /**
   * Latest APPROVAL machine state (transition log only; no projection table).
   */
  @Get(':correlationId/state')
  async getState(@Param('correlationId') correlationId: string) {
    const t = this.tenantContext.getRequired();
    const c = correlationId?.trim();
    if (!c) {
      throw new BadRequestException('correlationId is required.');
    }
    return this.approvals.getState(t, c);
  }

  /**
   * Registers a settlement approval request; policy engine selects REQUESTED→APPROVED vs REQUESTED→PENDING.
   */
  @Post('requests')
  @HttpCode(201)
  async registerRequest(@Body() body: RegisterApprovalRequestDto) {
    return this.approvals.registerSettlementApprovalRequest({
      tenantId: this.tenantContext.getRequired(),
      correlationId: body.correlationId.trim(),
      offerAmountCents: body.offerAmountCents,
      idempotencyKey: body.idempotencyKey.trim(),
      borrowerOptedOut: body.borrowerOptedOut,
    });
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
    return this.approvals.submitOfficerDecision({
      tenantId: this.tenantContext.getRequired(),
      correlationId: correlationId.trim(),
      fromState: body.fromState.trim(),
      decision: body.decision,
      officerId: body.officerId.trim(),
      idempotencyKey: body.idempotencyKey.trim(),
    });
  }
}
