import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqualStrings } from '../security/timing-safe-equal';

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
    if (!provided || !timingSafeEqualStrings(provided, expected)) {
      throw new UnauthorizedException('Invalid admin API key.');
    }
    return true;
  }
}
