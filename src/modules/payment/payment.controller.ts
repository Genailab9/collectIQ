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
import { ConfirmPaymentDto, CreatePaymentIntentDto } from './payment.dto';
import { PaymentService } from './payment.service';

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly tenantContext: TenantContextService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  @Get('pending')
  async pending() {
    return this.readModel.listPendingPayments(this.tenantContext.getRequired());
  }

  @Get(':paymentId/state')
  async getState(@Param('paymentId') paymentId: string) {
    const t = this.tenantContext.getRequired();
    const p = paymentId?.trim();
    if (!p) {
      throw new BadRequestException('paymentId is required.');
    }
    return this.payments.getPaymentState(t, p);
  }

  @Post('intents')
  @HttpCode(201)
  async createIntent(@Body() body: CreatePaymentIntentDto) {
    const ik = body.idempotencyKey?.trim() ?? '';
    if (!ik) {
      throw new BadRequestException('idempotencyKey is required.');
    }
    return this.payments.createPaymentIntent({
      tenantId: this.tenantContext.getRequired(),
      idempotencyKey: ik,
      amountCents: body.amountCents,
      currency: body.currency,
      approvalCorrelationId: body.approvalCorrelationId.trim(),
      borrowerOptedOut: body.borrowerOptedOut,
    });
  }

  @Post(':paymentId/confirm')
  @HttpCode(200)
  async confirm(@Param('paymentId') paymentId: string, @Body() body: ConfirmPaymentDto) {
    const t = this.tenantContext.getRequired();
    const p = paymentId?.trim();
    const gid = body.gatewayPaymentIntentId?.trim() ?? '';
    const ik = body.idempotencyKey?.trim() ?? '';
    if (!p || !gid || !ik) {
      throw new BadRequestException('paymentId, gatewayPaymentIntentId, and idempotencyKey are required.');
    }
    return this.payments.confirmPayment({
      tenantId: t,
      paymentId: p,
      gatewayPaymentIntentId: gid,
      idempotencyKey: ik,
      borrowerOptedOut: body.borrowerOptedOut,
    });
  }
}
