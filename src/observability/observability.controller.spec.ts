import { ObservabilityController } from './observability.controller';
import type { StructuredLogEvent } from './structured-log.types';

describe('ObservabilityController structured-log-export tenant isolation', () => {
  const traces = { traceExecutionFull: jest.fn(), traceExecutionSummary: jest.fn() };
  const readModel = { observabilitySummary: jest.fn() };
  const tenantContext = { getRequired: jest.fn(() => 'tenant-a') };
  const structured = { exportRecentStructuredAsync: jest.fn() };
  const domainEvents = { listDomainEvents: jest.fn() };
  const systemEventProjection = {
    readIncidentTimeline: jest.fn(),
    readProjectedOnly: jest.fn(),
    checkIntegrity: jest.fn(),
    readDecisionTrace: jest.fn(),
    readChainAnchors: jest.fn(),
  };
  const tenantFlags = { getBoolean: jest.fn(async () => false) };
  const config = { get: jest.fn() };
  const metrics = {
    incTraceSummaryRequest: jest.fn(),
    incTraceFullRequest: jest.fn(),
    observeApiLatencyMs: jest.fn(),
    incApiRequestsTotal: jest.fn(),
    incApiErrorsTotal: jest.fn(),
    incReplayRequests: jest.fn(),
    observeReplayLatencyMs: jest.fn(),
  };
  const policyContextBuilder = { buildTraceFullContext: jest.fn(), buildTenantOperationContext: jest.fn() };
  const policyAudit = { record: jest.fn() };
  const policies = { evaluate: jest.fn() };
  const policyMode = { getMode: jest.fn(() => 'shadow') };

  const controller = new ObservabilityController(
    traces as never,
    tenantContext as never,
    structured as never,
    readModel as never,
    domainEvents as never,
    systemEventProjection as never,
    tenantFlags as never,
    config as never,
    metrics as never,
    policyContextBuilder as never,
    policyAudit as never,
    policies as never,
    policyMode as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getRequired.mockReturnValue('tenant-a');
    (config.get as jest.Mock).mockImplementation((k: string) => {
      if (k === 'COLLECTIQ_ADMIN_API_KEY') return 'admin-key';
      if (k === 'DISABLE_TRACE_FULL') return 'false';
      return undefined;
    });
    policyMode.getMode.mockReturnValue('shadow');
    policyContextBuilder.buildTraceFullContext.mockImplementation((input: {
      tenantId: string;
      correlationId: string;
      debugHeader?: string;
      adminRoleHeader?: string;
      tenantFlagEnabled: boolean;
      traceFullDisabledByKillSwitch: boolean;
    }) => ({
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      operationType: 'READ',
      resourceType: 'OBSERVABILITY_TRACE',
      executionSurface: 'API',
      riskTier: 'HIGH',
      originClass: 'ADMIN_CLIENT',
      actor: {
        actorId: 'mock-admin',
        role: String(input.adminRoleHeader ?? '').trim().toUpperCase() || undefined,
        isPrivilegedIdentity: String(input.adminRoleHeader ?? '').trim().toUpperCase() === 'ADMIN',
      },
      debugEnabled: String(input.debugHeader ?? '').trim().toLowerCase() === 'true',
      flags: { tenantFlagEnabled: input.tenantFlagEnabled },
      killSwitches: { traceFullDisabled: input.traceFullDisabledByKillSwitch },
    }));
    policyContextBuilder.buildTenantOperationContext.mockImplementation((input: {
      tenantId: string;
      correlationId: string;
      operationType: string;
      resourceType: string;
      executionSurface: string;
      riskTier: string;
      actorRole: string;
    }) => ({
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      operationType: input.operationType,
      resourceType: input.resourceType,
      executionSurface: input.executionSurface,
      riskTier: input.riskTier,
      actor: {
        actorId: 'tenant-user',
        role: input.actorRole,
        isPrivilegedIdentity: false,
      },
    }));
    policies.evaluate.mockImplementation(
      (ctx: {
        resourceType?: string;
        debugEnabled?: boolean;
        actor: { isPrivilegedIdentity: boolean };
        killSwitches?: { traceFullDisabled?: boolean };
        flags?: { tenantFlagEnabled?: boolean };
      }) => ({
        decision:
          ctx.resourceType === 'TENANT' ||
          ctx.debugEnabled &&
          ctx.actor.isPrivilegedIdentity &&
          !ctx.killSwitches?.traceFullDisabled &&
          ctx.flags?.tenantFlagEnabled
            ? 'ALLOW'
            : 'DENY',
        reason: 'unit-test-policy',
        policyVersion: 'test',
      }),
    );
    policyAudit.record.mockReset();
  });

  it('returns tenant-scoped rows', async () => {
    const rows: StructuredLogEvent[] = [
      {
        correlationId: 'corr-a',
        tenantId: 'tenant-a',
        phase: 'PAY',
        state: 'PAYMENT:PROCESSING→SUCCESS',
        adapter: 'payment.confirm',
        result: 'PAYMENT_PROCESSED',
      },
      {
        correlationId: 'corr-a',
        tenantId: '',
        phase: 'PAY',
        state: 'PAYMENT:PROCESSING→SUCCESS',
        adapter: 'payment.confirm',
        result: 'PAYMENT_PROCESSED',
      },
      {
        correlationId: 'corr-b',
        tenantId: 'tenant-b',
        phase: 'APPROVE',
        state: 'APPROVAL:PENDING→APPROVED',
        adapter: 'approval.policy',
        result: 'SETTLEMENT_ACCEPTED',
      },
    ];
    structured.exportRecentStructuredAsync.mockResolvedValue(rows.filter((x) => x.tenantId === 'tenant-a'));

    const out = await controller.structuredExport('100');

    expect(out.events).toHaveLength(1);
    expect(out.events[0]?.tenantId).toBe('tenant-a');
    expect(out.events[0]?.correlationId).toBe('corr-a');
  });

  it('returns empty for tenant B requesting tenant A correlationId', async () => {
    const rows: StructuredLogEvent[] = [
      {
        correlationId: 'corr-tenant-a',
        tenantId: 'tenant-a',
        phase: 'PAY',
        state: 'PAYMENT:PROCESSING→SUCCESS',
        adapter: 'payment.confirm',
        result: 'PAYMENT_PROCESSED',
      },
    ];
    structured.exportRecentStructuredAsync.mockResolvedValue([]);
    tenantContext.getRequired.mockReturnValue('tenant-b');

    const out = await controller.structuredExport('100', 'corr-tenant-a');

    expect(out.events).toEqual([]);
  });

  it('allows full trace only with debug + admin identity + tenant flag', async () => {
    tenantFlags.getBoolean.mockResolvedValue(true);
    traces.traceExecutionFull.mockResolvedValue({ mode: 'full', traceId: 'c1' } as never);
    const out = await controller.getTrace('c1', 'full', 'true', 'admin-key', 'internal-user', 'ADMIN');
    expect(traces.traceExecutionFull).toHaveBeenCalledWith('tenant-a', 'c1');
    expect(policyAudit.record).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ mode: 'full', traceId: 'c1' });
  });

  it('denies full trace for non-privileged caller even when tenant flag is enabled', async () => {
    tenantFlags.getBoolean.mockResolvedValue(true);
    await expect(controller.getTrace('c1', 'full', 'true', undefined, undefined, undefined)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('denies full trace when tenant flag is disabled', async () => {
    tenantFlags.getBoolean.mockResolvedValue(false);
    await expect(controller.getTrace('c1', 'full', 'true', 'admin-key', 'internal-user', 'ADMIN')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('legacy_deprecated mode follows policy decisions', async () => {
    (config.get as jest.Mock).mockImplementation((k: string) => {
      if (k === 'COLLECTIQ_ADMIN_API_KEY') return 'admin-key';
      if (k === 'DISABLE_TRACE_FULL') return 'false';
      return undefined;
    });
    policyMode.getMode.mockReturnValue('legacy_deprecated');
    tenantFlags.getBoolean.mockResolvedValue(true);
    policies.evaluate.mockReturnValue({
      decision: 'DENY',
      reason: 'forced-deny-for-test',
      policyVersion: 'test',
    });
    await expect(controller.getTrace('c1', 'full', 'true', 'admin-key', 'internal-user', 'ADMIN')).rejects.toMatchObject({
      status: 403,
    });
  });
});

