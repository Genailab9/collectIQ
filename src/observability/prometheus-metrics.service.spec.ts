import { PrometheusMetricsService } from './prometheus-metrics.service';

describe('PrometheusMetricsService', () => {
  it('renders HELP/TYPE and counter lines in Prometheus text format', () => {
    const m = new PrometheusMetricsService();
    m.incExecutionsStarted('PAY');
    m.incExecutionsStarted('PAY');
    m.incExecutionsCompleted('PAY');
    m.incExecutionsFailed('compliance');
    m.incRetries('payment.createIntent');
    m.incCircuitBreakerTripped();
    m.incCircuitBreakerRejected();
    m.incPaymentFailures('verify');

    const text = m.renderPrometheusText();
    expect(text).toContain('# HELP collectiq_executions_started_total');
    expect(text).toContain('# TYPE collectiq_executions_started_total counter');
    expect(text).toMatch(/collectiq_executions_started_total\{phase="PAY"\} 2/);
    expect(text).toMatch(/collectiq_executions_completed_total\{phase="PAY"\} 1/);
    expect(text).toMatch(/collectiq_executions_failed_total\{reason="compliance"\} 1/);
    expect(text).toMatch(/collectiq_retries_count_total\{operation="payment.createIntent"\} 1/);
    expect(text).toMatch(/collectiq_circuit_breaker_open_total\{event="trip"\} 1/);
    expect(text).toMatch(/collectiq_circuit_breaker_open_total\{event="reject"\} 1/);
    expect(text).toMatch(/collectiq_payment_failures_total\{step="verify"\} 1/);
  });
});
