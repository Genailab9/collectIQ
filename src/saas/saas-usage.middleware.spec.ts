import type { NextFunction, Request, Response } from 'express';
import { SaaSUsageMiddleware } from './saas-usage.middleware';

describe('SaaSUsageMiddleware (reliability matrix)', () => {
  const tenantContext = { getRequired: jest.fn(() => 'tenant-x') };
  const usage = { incrementApiCalls: jest.fn(async () => undefined) };
  let middleware: SaaSUsageMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new SaaSUsageMiddleware(tenantContext as never, usage as never);
    next = jest.fn();
  });

  it('skips counting for /saas/admin paths', async () => {
    const req = { path: '/saas/admin/tenants' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(usage.incrementApiCalls).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips counting for billing webhook', async () => {
    const req = { path: '/saas/billing/webhook' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(usage.incrementApiCalls).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('increments API usage for /execution prefix', async () => {
    const req = { path: '/execution/active' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(usage.incrementApiCalls).toHaveBeenCalledWith('tenant-x', 1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('increments for exact /saas/tenant path', async () => {
    const req = { path: '/saas/tenant/me' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(usage.incrementApiCalls).toHaveBeenCalledWith('tenant-x', 1);
  });

  it('does not increment for unrelated paths', async () => {
    const req = { path: '/health' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(usage.incrementApiCalls).not.toHaveBeenCalled();
  });

  it('never blocks when tenant context is missing', async () => {
    tenantContext.getRequired.mockImplementation(() => {
      throw new Error('no tenant');
    });
    const req = { path: '/execution/x' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(usage.incrementApiCalls).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never blocks when increment throws', async () => {
    usage.incrementApiCalls.mockRejectedValueOnce(new Error('db down'));
    const req = { path: '/payments/pending' } as Request;
    await middleware.use(req, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
