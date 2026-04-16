import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqualStrings } from '../security/timing-safe-equal';
import { emitRuntimeProof } from '../runtime-proof/runtime-proof-emitter';

@Injectable()
export class SaaSAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('COLLECTIQ_ADMIN_API_KEY')?.trim() ?? '';
    if (!expected) {
      throw new UnauthorizedException('COLLECTIQ_ADMIN_API_KEY is not configured.');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const provided = String(req.header('x-collectiq-admin-key') ?? '').trim();
    const role = String(req.header('x-collectiq-admin-role') ?? '').trim().toUpperCase();
    if (!provided || !timingSafeEqualStrings(provided, expected)) {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'admin_key_invalid' },
      });
      throw new UnauthorizedException('Invalid admin API key.');
    }
    if (role !== 'ADMIN' && role !== 'SYSTEM') {
      emitRuntimeProof({
        requirement_id: 'REQ-SEC-002',
        event_type: 'AUTH_EVENT',
        tenant_id: 'n/a',
        metadata: { path: req.path, method: req.method, reason: 'admin_role_missing' },
      });
      throw new UnauthorizedException('Admin role is required for control-plane access.');
    }
    emitRuntimeProof({
      requirement_id: 'REQ-SEC-002',
      event_type: 'AUTH_EVENT',
      tenant_id: 'n/a',
      metadata: { path: req.path, method: req.method, result: 'accepted' },
    });
    return true;
  }
}
