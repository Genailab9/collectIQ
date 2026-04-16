import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TwilioSignatureVerifier } from '../twilio/twilio-signature.verifier';
import { TwilioTelephonyConfig } from '../twilio/twilio-telephony.config';
import { emitRuntimeProof } from '../../../runtime-proof/runtime-proof-emitter';

/**
 * PRD §16 — Twilio webhook authenticity: HMAC-SHA1 over the public callback URL + POST body using the auth token from env
 * (`TWILIO_AUTH_TOKEN` via `TwilioTelephonyConfig`). No secrets are embedded in code.
 */
@Injectable()
export class TwilioWebhookSignatureGuard implements CanActivate {
  constructor(private readonly twilioCfg: TwilioTelephonyConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const authToken = this.twilioCfg.authToken;
    const webhookBase = this.twilioCfg.webhookPublicBaseUrl;
    if ((!authToken || !webhookBase) && this.twilioCfg.bootMode === 'demo-safe') {
      return true;
    }
    const signature = req.header('x-twilio-signature');
    if (!signature) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'twilio_signature_missing' },
      });
      throw new UnauthorizedException('Missing Twilio signature header.');
    }
    if (!authToken || !webhookBase) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'twilio_credentials_missing' },
      });
      throw new UnauthorizedException('Twilio webhook credentials are not configured.');
    }

    const fullUrl = `${webhookBase}${req.originalUrl}`;
    const formBody = coerceFormBody(req.body);

    const ok = TwilioSignatureVerifier.verify({
      authToken,
      signature,
      fullUrl,
      formBody,
    });

    if (!ok) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'twilio_signature_invalid' },
      });
      throw new UnauthorizedException('Invalid Twilio signature.');
    }

    emitRuntimeProof({
      requirement_id: 'REQ-SEC-002',
      event_type: 'AUTH_EVENT',
      tenant_id: 'n/a',
      metadata: { path: req.path, method: req.method, result: 'twilio_signature_verified' },
    });
    return true;
  }
}

function coerceFormBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (value === undefined || value === null) {
      continue;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}
