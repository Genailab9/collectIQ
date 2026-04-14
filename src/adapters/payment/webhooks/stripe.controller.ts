import { BadRequestException, Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Request } from 'express';
import { StripeWebhookSignatureGuard } from './stripe-webhook.signature.guard';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks/payment')
export class StripeWebhookController {
  constructor(
    private readonly stripeWebhooks: StripeWebhookService,
    private readonly config: ConfigService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  @UseGuards(StripeWebhookSignatureGuard)
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const tenantId = String(req.header('x-collectiq-tenant-id') ?? '').trim();
    if (!tenantId) {
      throw new BadRequestException('Missing x-collectiq-tenant-id header.');
    }
    const signature = req.header('stripe-signature') ?? '';
    const secret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    const event = stripeVerifier().webhooks.constructEvent(req.rawBody as Buffer, signature, secret);

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.processing') {
      const dataObject = event.data?.object as { object?: string; id?: string; status?: string } | undefined;
      if (dataObject?.object !== 'payment_intent') {
        return { ok: true };
      }
      const gatewayPaymentIntentId = dataObject.id?.trim() ?? '';
      const providerStatus = typeof dataObject.status === 'string' ? dataObject.status : '';
      if (gatewayPaymentIntentId && providerStatus) {
        await this.stripeWebhooks.handlePaymentIntentEvent({
          tenantId,
          eventId: event.id,
          gatewayPaymentIntentId,
          providerStatus,
          rawPayload: body,
        });
      }
      return { ok: true };
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data?.object as Stripe.Charge | undefined;
      const piRaw = charge?.payment_intent;
      const gatewayPaymentIntentId =
        typeof piRaw === 'string' ? piRaw.trim() : (piRaw?.id?.trim() ?? charge?.id?.trim() ?? '');
      if (gatewayPaymentIntentId) {
        await this.stripeWebhooks.handleChargeRefunded({
          tenantId,
          eventId: event.id,
          gatewayPaymentIntentId,
          rawPayload: body,
        });
      }
      return { ok: true };
    }

    if (event.type === 'charge.dispute.created') {
      const dispute = event.data?.object as Stripe.Dispute | undefined;
      const piRaw = dispute?.payment_intent;
      const gatewayPaymentIntentId =
        typeof piRaw === 'string' ? piRaw.trim() : (piRaw?.id?.trim() ?? '');
      if (gatewayPaymentIntentId) {
        await this.stripeWebhooks.handleChargeDisputeCreated({
          tenantId,
          eventId: event.id,
          gatewayPaymentIntentId,
          rawPayload: body,
        });
      }
      return { ok: true };
    }

    return { ok: true };
  }
}

function stripeVerifier(): Stripe {
  return new Stripe('sk_test_webhook_signature_only');
}
