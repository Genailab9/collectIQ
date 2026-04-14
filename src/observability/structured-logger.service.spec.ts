import { Logger } from '@nestjs/common';
import { StructuredLoggerService } from './structured-logger.service';

describe('StructuredLoggerService', () => {
  it('emits JSON with required PRD §12 fields', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const svc = new StructuredLoggerService();

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
});
