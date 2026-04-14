import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantIsolationGuard } from './tenant-isolation.guard';
import { TenantContextService } from './tenant-context.service';

describe('TenantIsolationGuard', () => {
  function makeGuard(tenantOptional: string | undefined) {
    const tenantContext = {
      getOptional: () => tenantOptional,
      getRequired: () => {
        const t = tenantOptional;
        if (!t) {
          throw new ForbiddenException('missing');
        }
        return t;
      },
    } as unknown as TenantContextService;
    return new TenantIsolationGuard(tenantContext, new Reflector());
  }

  function httpContext(method: string, path: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, path }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows webhooks without tenant ALS', () => {
    const g = makeGuard(undefined);
    expect(g.canActivate(httpContext('POST', '/webhooks/telephony/twilio/voice/status'))).toBe(true);
  });

  it('allows /metrics', () => {
    const g = makeGuard(undefined);
    expect(g.canActivate(httpContext('GET', '/metrics'))).toBe(true);
  });

  it('allows /system resilience endpoint without tenant ALS', () => {
    const g = makeGuard(undefined);
    expect(g.canActivate(httpContext('GET', '/system/resilience-check'))).toBe(true);
  });

  it('allows OPTIONS', () => {
    const g = makeGuard(undefined);
    expect(g.canActivate(httpContext('OPTIONS', '/v1/x'))).toBe(true);
  });

  it('FAILs API path when tenant context missing', () => {
    const g = makeGuard(undefined);
    expect(() => g.canActivate(httpContext('GET', '/payments/x'))).toThrow(ForbiddenException);
  });

  it('allows API path when tenant context present', () => {
    const g = makeGuard('tenant-1');
    expect(g.canActivate(httpContext('GET', '/payments/x'))).toBe(true);
  });
});
