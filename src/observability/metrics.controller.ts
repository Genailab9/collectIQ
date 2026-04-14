import { Controller, Get, Header } from '@nestjs/common';
import { PrometheusMetricsService } from './prometheus-metrics.service';

/**
 * Prometheus scrape endpoint (no tenant header; bypass {@link TenantMiddleware}).
 */
@Controller()
export class MetricsController {
  constructor(private readonly metrics: PrometheusMetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    return this.metrics.renderPrometheusText();
  }
}
