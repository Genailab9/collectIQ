import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Request } from 'express';

@Injectable()
export class StripeWebhookSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const signature = req.header('stripe-signature');
    if (!signature) {
      throw new UnauthorizedException('Missing Stripe signature header.');
    }
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim() ?? '';
    if (!secret) {
      throw new UnauthorizedException('Stripe webhook secret is not configured.');
    }
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new UnauthorizedException('Missing Stripe raw payload.');
    }
    try {
      // Signature verification only; controller re-parses event for extraction.
      stripeVerifier().webhooks.constructEvent(raw, signature, secret);
      return true;
    } catch (e) {
      throw new UnauthorizedException(
        e instanceof Error ? `Invalid Stripe signature: ${e.message}` : 'Invalid Stripe signature.',
      );
    }
  }
}

function stripeVerifier(): Stripe {
  return new Stripe('sk_test_webhook_signature_only');
}
