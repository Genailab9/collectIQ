import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Request } from 'express';
import { emitRuntimeProof } from '../../../runtime-proof/runtime-proof-emitter';

@Injectable()
export class StripeWebhookSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const signature = req.header('stripe-signature');
    if (!signature) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'stripe_signature_missing' },
      });
      throw new UnauthorizedException('Missing Stripe signature header.');
    }
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim() ?? '';
    if (!secret) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'stripe_secret_missing' },
      });
      throw new UnauthorizedException('Stripe webhook secret is not configured.');
    }
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'stripe_raw_body_missing' },
      });
      throw new UnauthorizedException('Missing Stripe raw payload.');
    }
    try {
      // Signature verification only; controller re-parses event for extraction.
      stripeVerifier().webhooks.constructEvent(raw, signature, secret);
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, result: 'stripe_signature_verified' },
      });
      return true;
    } catch (e) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'stripe_signature_invalid' },
      });
      throw new UnauthorizedException(
        e instanceof Error ? `Invalid Stripe signature: ${e.message}` : 'Invalid Stripe signature.',
      );
    }
  }
}

function stripeVerifier(): Stripe {
  return new Stripe('sk_test_webhook_signature_only');
}
