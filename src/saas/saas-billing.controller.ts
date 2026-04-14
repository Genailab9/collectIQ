import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import Stripe from 'stripe';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AdminAuditLogService } from '../survival/admin-audit-log.service';
import { SaaSTenantService } from './saas-tenant.service';
import type { SaaSPlan } from './entities/tenant-saas-profile.entity';

@Controller('saas/billing')
export class SaaSBillingController {
  constructor(
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
    private readonly tenants: SaaSTenantService,
    private readonly adminAudit: AdminAuditLogService,
  ) {}

  @Get('summary')
  async summary() {
    const tenantId = this.tenantContext.getRequired();
    const profile = await this.tenants.getOrCreate(tenantId);
    const limits = planLimits(profile.plan);
    return {
      plan: profile.plan,
      usage: {
        cases: profile.caseCount,
        apiCalls: profile.apiCallCount,
        paymentsProcessed: profile.paymentProcessedCount,
      },
      limits,
    };
  }

  @Post('checkout-session')
  async checkoutSession(@Body() body: { plan?: string; successUrl?: string; cancelUrl?: string }) {
    const tenantId = this.tenantContext.getRequired();
    const plan = (body.plan ?? '').trim().toLowerCase();
    if (plan !== 'pro' && plan !== 'enterprise') {
      throw new BadRequestException('plan must be "pro" or "enterprise".');
    }
    const secret =
      this.config.get<string>('COLLECTIQ_STRIPE_BILLING_SECRET_KEY')?.trim() ||
      this.config.get<string>('STRIPE_SECRET_KEY')?.trim() ||
      '';
    if (!secret) {
      throw new BadRequestException('Stripe billing secret key is not configured.');
    }
    const priceId =
      plan === 'pro'
        ? this.config.get<string>('COLLECTIQ_STRIPE_PRICE_PRO')?.trim()
        : this.config.get<string>('COLLECTIQ_STRIPE_PRICE_ENTERPRISE')?.trim();
    if (!priceId) {
      throw new BadRequestException(`Missing Stripe price id for plan=${plan}.`);
    }
    const stripe = new Stripe(secret);
    const base =
      this.config.get<string>('COLLECTIQ_PUBLIC_APP_URL')?.trim() || 'http://localhost:3001';
    const successUrl = body.successUrl?.trim() || `${base}/billing?status=success`;
    const cancelUrl = body.cancelUrl?.trim() || `${base}/billing?status=cancel`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: tenantId,
      subscription_data: {
        metadata: {
          collectiqTenantId: tenantId,
          collectiqPlan: plan,
        },
      },
      metadata: {
        collectiqTenantId: tenantId,
        collectiqPlan: plan,
      },
    });
    await this.adminAudit.record({
      tenantId,
      actor: 'billing',
      action: 'checkout.session.created',
      detail: { plan, sessionId: session.id },
    });
    return { url: session.url };
  }

  @Post('webhook')
  @HttpCode(200)
  async billingWebhook(
    @Req() req: RawBodyRequest<Request & { rawBody?: Buffer }>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const secret = this.config.get<string>('COLLECTIQ_STRIPE_BILLING_WEBHOOK_SECRET')?.trim() ?? '';
    if (!secret) {
      throw new BadRequestException('Billing webhook secret not configured.');
    }
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new BadRequestException('Missing raw body for Stripe webhook.');
    }
    const stripeKey =
      this.config.get<string>('COLLECTIQ_STRIPE_BILLING_SECRET_KEY')?.trim() ||
      this.config.get<string>('STRIPE_SECRET_KEY')?.trim() ||
      'sk_test_placeholder';
    const stripe = new Stripe(stripeKey);
    const event = stripe.webhooks.constructEvent(raw, signature ?? '', secret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.collectiqTenantId?.trim();
      const planRaw = (session.metadata?.collectiqPlan ?? 'pro').trim().toLowerCase();
      const plan: SaaSPlan = planRaw === 'enterprise' ? 'enterprise' : 'pro';
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription && 'id' in session.subscription
            ? String((session.subscription as { id: string }).id)
            : '';
      const customerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer && 'id' in session.customer
            ? String((session.customer as { id: string }).id)
            : '';
      if (tenantId && subscriptionId) {
        await this.tenants.attachStripeSubscription({
          tenantId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          plan,
        });
        await this.adminAudit.record({
          tenantId,
          actor: 'stripe-billing-webhook',
          action: 'subscription.attached',
          detail: { plan, subscriptionId },
        });
      }
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = sub.metadata?.collectiqTenantId?.trim();
      const planRaw = (sub.metadata?.collectiqPlan ?? 'pro').trim().toLowerCase();
      const plan: SaaSPlan = planRaw === 'enterprise' ? 'enterprise' : 'pro';
      const customerId = typeof sub.customer === 'string' ? sub.customer : String(sub.customer ?? '');
      if (tenantId) {
        await this.tenants.attachStripeSubscription({
          tenantId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          plan,
        });
        await this.adminAudit.record({
          tenantId,
          actor: 'stripe-billing-webhook',
          action: 'subscription.updated',
          detail: { plan, subscriptionId: sub.id },
        });
      }
    }
    return { received: true };
  }
}

function planLimits(plan: string): { cases: number | null; apiCalls: number | null; payments: number | null } {
  if (plan === 'enterprise') {
    return { cases: null, apiCalls: null, payments: null };
  }
  if (plan === 'pro') {
    return { cases: 50_000, apiCalls: 500_000, payments: 50_000 };
  }
  return { cases: 500, apiCalls: 10_000, payments: 500 };
}
