import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { PrdSecurityMiddleware } from './prd-security.middleware';

function makeMw(env: Record<string, string | undefined>) {
  const config = {
    get: (k: string) => env[k],
  } as unknown as ConfigService;
  return new PrdSecurityMiddleware(config);
}

describe('PrdSecurityMiddleware', () => {
  it('allows webhooks without API key', (done) => {
    const mw = makeMw({ COLLECTIQ_API_KEY: 'secret' });
    const req = {
      method: 'POST',
      path: '/webhooks/telephony/twilio/voice/status',
      headers: {},
      header: () => undefined,
    } as unknown as Request;
    const res = {} as Response;
    mw.use(req, res, ((err?: unknown) => {
      expect(err).toBeUndefined();
      done();
    }) as NextFunction);
  });

  it('rejects execution path when TLS required but request not HTTPS', (done) => {
    const mw = makeMw({ COLLECTIQ_REQUIRE_TLS: 'true' });
    const req = {
      method: 'POST',
      path: '/payments/x',
      headers: {},
      secure: false,
      header: () => undefined,
    } as unknown as Request;
    const res = {} as Response;
    mw.use(req, res, ((err?: unknown) => {
      expect(err).toBeInstanceOf(ForbiddenException);
      done();
    }) as NextFunction);
  });

  it('allows payments when API key header matches', (done) => {
    const mw = makeMw({ COLLECTIQ_API_KEY: 'abc123' });
    const req = {
      method: 'GET',
      path: '/payments/p1/state',
      headers: { 'x-collectiq-api-key': 'abc123' },
      secure: false,
      header: (name: string) =>
        name.toLowerCase() === 'x-collectiq-api-key' ? 'abc123' : undefined,
    } as unknown as Request;
    const res = {} as Response;
    mw.use(req, res, ((err?: unknown) => {
      expect(err).toBeUndefined();
      done();
    }) as NextFunction);
  });

  it('rejects execution path when API key wrong', (done) => {
    const mw = makeMw({ COLLECTIQ_API_KEY: 'expected' });
    const req = {
      method: 'POST',
      path: '/execution/call/authenticate',
      headers: { 'x-collectiq-api-key': 'wrong' },
      secure: false,
      header: (name: string) =>
        name.toLowerCase() === 'x-collectiq-api-key' ? 'wrong' : undefined,
    } as unknown as Request;
    const res = {} as Response;
    mw.use(req, res, ((err?: unknown) => {
      expect(err).toBeInstanceOf(UnauthorizedException);
      done();
    }) as NextFunction);
  });

  it('rejects /system resilience gate when API key is missing', (done) => {
    const mw = makeMw({ COLLECTIQ_API_KEY: 'expected' });
    const req = {
      method: 'GET',
      path: '/system/resilience-check',
      headers: {},
      secure: false,
      header: () => undefined,
    } as unknown as Request;
    const res = {} as Response;
    mw.use(req, res, ((err?: unknown) => {
      expect(err).toBeInstanceOf(UnauthorizedException);
      done();
    }) as NextFunction);
  });
});
