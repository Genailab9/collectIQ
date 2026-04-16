import { Logger } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';

describe('StructuredLoggerService', () => {
  it('emits JSON with required PRD §12 fields', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const svc = new StructuredLoggerService({ get: jest.fn(() => undefined) } as never);

    svc.emit({
      correlationId: 'c1',
      tenantId: 't1',
      phase: 'CALL',
      state: 'CALL:CONNECTED→AUTHENTICATED',
      adapter: 'telephony.initiateCall',
      result: 'ADAPTER_START',
      surface: 'SMEK_ADAPTER',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.correlationId).toBe('c1');
    expect(parsed.tenantId).toBe('t1');
    expect(parsed.phase).toBe('CALL');
    expect(parsed.state).toBe('CALL:CONNECTED→AUTHENTICATED');
    expect(parsed.adapter).toBe('telephony.initiateCall');
    expect(parsed.result).toBe('ADAPTER_START');
    expect(parsed.surface).toBe('SMEK_ADAPTER');
    spy.mockRestore();
  });

  it('stores only sanitized, capped messages in the export ring', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const svc = new StructuredLoggerService({ get: jest.fn(() => undefined) } as never);
    const long = "x".repeat(5000);
    svc.emit({
      correlationId: 'c1',
      tenantId: 't1',
      phase: 'CALL',
      state: 'CALL:INIT',
      adapter: 'x',
      result: 'ERR',
      message: long,
    });
    const exported = svc.exportRecentStructured('t1', 10);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.message?.length ?? 0).toBeLessThanOrEqual(2100);
    expect(exported[0]?.message?.endsWith('…[truncated]')).toBe(true);
    jest.restoreAllMocks();
  });
});
