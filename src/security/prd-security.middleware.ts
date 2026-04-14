import {
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqualStrings } from './timing-safe-equal';

const EXECUTION_PATH_PREFIXES = [
  '/payments',
  '/approvals',
  '/execution',
  '/ingestion',
  '/observability',
  '/system',
  '/saas',
  '/analytics',
  '/survival',
  '/campaigns',
  '/dashboard',
  '/feature-flags',
  '/demo',
] as const;

function pathRequiresExecutionApiKey(path: string): boolean {
  const p = path.split('?')[0] ?? '';
  if (p.startsWith('/saas/admin')) {
    return false;
  }
  if (p === '/saas/billing/webhook') {
    return false;
  }
  return EXECUTION_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

function isLikelyHttps(req: Request): boolean {
  if (req.secure) {
    return true;
  }
  const xfp = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  return xfp === 'https';
}

/**
 * PRD §16 — TLS expectation (when configured) and API key for execution HTTP surface.
 * Webhooks rely on provider signature guards (e.g. Twilio) instead of this API key.
 */
@Injectable()
export class PrdSecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PrdSecurityMiddleware.name);

  constructor(private readonly config: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.path ?? '';

    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (path.startsWith('/webhooks/') || path === '/metrics') {
      next();
      return;
    }

    const requireTls = this.isTruthy(this.config.get<string>('COLLECTIQ_REQUIRE_TLS'));
    if (requireTls && !isLikelyHttps(req)) {
      this.logger.warn(`prd.security.tls_rejected method=${req.method} path=${path}`);
      next(
        new ForbiddenException(
          'PRD §16: TLS is required (set COLLECTIQ_TRUST_PROXY=1 behind a TLS-terminating reverse proxy).',
        ),
      );
      return;
    }

    if (!pathRequiresExecutionApiKey(path)) {
      next();
      return;
    }

    const primary = this.config.get<string>('COLLECTIQ_API_KEY')?.trim();
    const legacy = this.config.get<string>('COLLECTIQ_EXECUTION_API_KEY')?.trim();
    const rotation = (this.config.get<string>('COLLECTIQ_API_KEYS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const acceptedKeys = [...new Set([primary, legacy, ...rotation].filter((s): s is string => !!s))];
    if (acceptedKeys.length === 0) {
      next();
      return;
    }

    const apiKey = String(req.header('x-collectiq-api-key') ?? '').trim();
    const execKey = String(req.header('x-collectiq-execution-key') ?? '').trim();
    const candidates = [apiKey, execKey].filter((s) => s.length > 0);
    const ok = candidates.some((c) => acceptedKeys.some((k) => timingSafeEqualStrings(k, c)));
    if (!ok) {
      this.logger.warn(`prd.security.api_key_rejected method=${req.method} path=${path}`);
      next(
        new UnauthorizedException(
          'PRD §16: missing or invalid API key (send X-CollectIQ-Api-Key, or X-CollectIQ-Execution-Key when using COLLECTIQ_EXECUTION_API_KEY).',
        ),
      );
      return;
    }

    next();
  }

  private isTruthy(raw: string | undefined): boolean {
    if (raw === undefined || raw.trim() === '') {
      return false;
    }
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }
}
