/**
 * SaaS reliability + monetization matrix: Stripe checkout, webhooks, billing summary limits.
 * Stripe SDK is mocked; no network calls.
 */
const mockConstructEvent = jest.fn();
const mockCheckoutSessionsCreate = jest.fn();

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
    },
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args),
      },
    },
  })),
}));

import { BadRequestException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SaaSBillingController } from './saas-billing.controller';

describe('SaaSBillingController monetization + webhook matrix', () => {
  const config = { get: jest.fn() };
  const tenantContext = { getRequired: jest.fn(() => 'tenant-a') };
  const attachStripeSubscription = jest.fn(async () => undefined);
  const tenants = {
    getOrCreate: jest.fn(),
    attachStripeSubscription,
  };
  const adminAudit = { record: jest.fn(async () => undefined) };
  const structured = { emit: jest.fn() };
  const policyEnforcement = { enforceTenantOperation: jest.fn() };
  const metrics = {
    incApiRequestsTotal: jest.fn(),
    observeApiLatencyMs: jest.fn(),
    incApiErrorsTotal: jest.fn(),
  };

  const controller = new SaaSBillingController(
    config as never,
    tenantContext as never,
    tenants as never,
    adminAudit as never,
    structured as never,
    policyEnforcement as never,
    metrics as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getRequired.mockReturnValue('tenant-a');
    policyEnforcement.enforceTenantOperation.mockReturnValue(undefined);
    mockConstructEvent.mockReset();
    mockCheckoutSessionsCreate.mockReset();
  });

  describe('summary / plan limits', () => {
    it('returns free-tier limits', async () => {
      tenants.getOrCreate.mockResolvedValueOnce({
        plan: 'free',
        caseCount: 1,
        apiCallCount: 2,
        paymentProcessedCount: 3,
      });
      const out = await controller.summary();
      expect(out.limits).toEqual({ cases: 500, apiCalls: 10_000, payments: 500 });
    });

    it('returns pro-tier limits', async () => {
      tenants.getOrCreate.mockResolvedValueOnce({
        plan: 'pro',
        caseCount: 0,
        apiCallCount: 0,
        paymentProcessedCount: 0,
      });
      const out = await controller.summary();
      expect(out.limits).toEqual({ cases: 50_000, apiCalls: 500_000, payments: 50_000 });
    });

    it('returns enterprise unlimited limits', async () => {
      tenants.getOrCreate.mockResolvedValueOnce({
        plan: 'enterprise',
        caseCount: 100,
        apiCallCount: 200,
        paymentProcessedCount: 50,
      });
      const out = await controller.summary();
      expect(out.limits).toEqual({ cases: null, apiCalls: null, payments: null });
    });
  });

  describe('checkout-session', () => {
    beforeEach(() => {
      (config.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'COLLECTIQ_STRIPE_BILLING_SECRET_KEY') return 'sk_test_x';
        if (key === 'COLLECTIQ_STRIPE_PRICE_PRO') return 'price_pro';
        if (key === 'COLLECTIQ_STRIPE_PRICE_ENTERPRISE') return 'price_ent';
        if (key === 'COLLECTIQ_PUBLIC_APP_URL') return 'https://app.example';
        return undefined;
      });
      mockCheckoutSessionsCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs' });
    });

    it('rejects invalid plan', async () => {
      await expect(controller.checkoutSession({ plan: 'free' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when Stripe secret missing', async () => {
      (config.get as jest.Mock).mockImplementation(() => undefined);
      await expect(controller.checkoutSession({ plan: 'pro' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when price id missing for plan', async () => {
      (config.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'COLLECTIQ_STRIPE_BILLING_SECRET_KEY') return 'sk_test';
        return undefined;
      });
      await expect(controller.checkoutSession({ plan: 'pro' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates checkout session, audits, emits control-plane event', async () => {
      const out = await controller.checkoutSession({ plan: 'enterprise' });
      expect(out.url).toBe('https://checkout.stripe.test/cs');
      expect(mockCheckoutSessionsCreate).toHaveBeenCalled();
      const createArg = mockCheckoutSessionsCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.metadata).toEqual(
        expect.objectContaining({ collectiqTenantId: 'tenant-a', collectiqPlan: 'enterprise' }),
      );
      expect(adminAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'checkout.session.created', tenantId: 'tenant-a' }),
      );
      expect(structured.emit).toHaveBeenCalled();
    });
  });

  describe('billing webhook', () => {
    const rawBody = Buffer.from('{"id":"evt_1"}');

    beforeEach(() => {
      (config.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'COLLECTIQ_STRIPE_BILLING_WEBHOOK_SECRET') return 'whsec_test';
        if (key === 'COLLECTIQ_STRIPE_BILLING_SECRET_KEY') return 'sk_test';
        return undefined;
      });
    });

    it('rejects when webhook secret not configured', async () => {
      (config.get as jest.Mock).mockReturnValue(undefined);
      const req = { rawBody } as RawBodyRequest<Request & { rawBody?: Buffer }>;
      await expect(controller.billingWebhook(req, 'sig')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when raw body missing', async () => {
      const req = {} as RawBodyRequest<Request & { rawBody?: Buffer }>;
      await expect(controller.billingWebhook(req, 'sig')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checkout.session.completed attaches subscription and records audit', async () => {
      mockConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { collectiqTenantId: 't-webhook', collectiqPlan: 'enterprise' },
            subscription: 'sub_webhook_1',
            customer: 'cus_webhook_1',
          },
        },
      });
      const req = { rawBody } as RawBodyRequest<Request & { rawBody?: Buffer }>;
      const out = await controller.billingWebhook(req, 'stripe-sig');
      expect(out).toEqual({ received: true });
      expect(attachStripeSubscription).toHaveBeenCalledWith({
        tenantId: 't-webhook',
        stripeCustomerId: 'cus_webhook_1',
        stripeSubscriptionId: 'sub_webhook_1',
        plan: 'enterprise',
      });
      expect(adminAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't-webhook', action: 'subscription.attached' }),
      );
      expect(structured.emit).toHaveBeenCalled();
    });

    it('checkout.session.completed does not attach when subscription id missing', async () => {
      mockConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { collectiqTenantId: 't-only' },
            subscription: '',
            customer: 'cus_1',
          },
        },
      });
      const req = { rawBody } as RawBodyRequest<Request & { rawBody?: Buffer }>;
      await controller.billingWebhook(req, 'sig');
      expect(attachStripeSubscription).not.toHaveBeenCalled();
    });

    it('customer.subscription.updated attaches plan from metadata', async () => {
      mockConstructEvent.mockReturnValue({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_upd_1',
            metadata: { collectiqTenantId: 't-sub', collectiqPlan: 'pro' },
            customer: 'cus_sub_1',
          },
        },
      });
      const req = { rawBody } as RawBodyRequest<Request & { rawBody?: Buffer }>;
      await controller.billingWebhook(req, 'sig');
      expect(attachStripeSubscription).toHaveBeenCalledWith({
        tenantId: 't-sub',
        stripeCustomerId: 'cus_sub_1',
        stripeSubscriptionId: 'sub_upd_1',
        plan: 'pro',
      });
      expect(adminAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.updated', tenantId: 't-sub' }),
      );
    });

    it('returns received for unrelated event types without attach', async () => {
      mockConstructEvent.mockReturnValue({
        type: 'invoice.paid',
        data: { object: {} },
      });
      const req = { rawBody } as RawBodyRequest<Request & { rawBody?: Buffer }>;
      const out = await controller.billingWebhook(req, 'sig');
      expect(out).toEqual({ received: true });
      expect(attachStripeSubscription).not.toHaveBeenCalled();
    });
  });
});
