import { ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { SaaSAuditController } from './saas-audit.controller';

async function readStreamableJson(file: { getStream: () => NodeJS.ReadableStream }): Promise<Record<string, unknown>> {
  const stream = file.getStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

describe('SaaSAuditController policy integration', () => {
  const tenantContext = { getRequired: jest.fn(() => 'tenant-a') };
  const tracePayload = {
    correlationId: 'corr-1',
    transitions: [{ machine: 'CALL', from: 'A', to: 'B', occurredAt: '2026-01-01T00:00:00.000Z' }],
    adapterCalls: [],
    errors: [],
  };
  const traces = {
    traceExecution: jest.fn(async () => tracePayload),
  };
  const pdf = {
    renderCaseAuditPdf: jest.fn(async () => Buffer.from('pdf')),
  };
  const policyEnforcement = { enforceTenantOperation: jest.fn() };
  const metrics = {
    incApiRequestsTotal: jest.fn(),
    observeApiLatencyMs: jest.fn(),
    incApiErrorsTotal: jest.fn(),
  };

  const controller = new SaaSAuditController(
    tenantContext as never,
    traces as never,
    pdf as never,
    policyEnforcement as never,
    metrics as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getRequired.mockReturnValue('tenant-a');
    policyEnforcement.enforceTenantOperation.mockReturnValue(undefined);
  });

  it('exports JSON audit when policy allows', async () => {
    const out = await controller.export('corr-1');
    expect(out).toBeDefined();
    expect(policyEnforcement.enforceTenantOperation).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      correlationId: 'audit-export:corr-1',
      operationType: 'READ',
      riskTier: 'MEDIUM',
    });
    const json = await readStreamableJson(out);
    expect(json.correlationId).toBe('corr-1');
    expect(Array.isArray(json.transitions)).toBe(true);
    expect((json.transitions as unknown[]).length).toBe(1);
  });

  it('trims correlation id in policy correlation and trace fetch', async () => {
    await controller.export('  spaced-corr  ');
    expect(traces.traceExecution).toHaveBeenCalledWith('tenant-a', 'spaced-corr');
    expect(policyEnforcement.enforceTenantOperation).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'audit-export:spaced-corr' }),
    );
  });

  it('exports PDF audit when policy allows', async () => {
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
    } as unknown as Response;
    await controller.exportPdf('corr-2', res);
    expect(policyEnforcement.enforceTenantOperation).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      correlationId: 'audit-export-pdf:corr-2',
      operationType: 'READ',
      riskTier: 'MEDIUM',
    });
    expect(res.send).toHaveBeenCalledTimes(1);
  });

  it('denies export when policy rejects request', async () => {
    policyEnforcement.enforceTenantOperation.mockImplementation(() => {
      throw new ForbiddenException();
    });
    await expect(controller.export('corr-3')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
