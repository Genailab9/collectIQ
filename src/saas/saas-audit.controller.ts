import { Controller, Get, Header, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TraceExecutionService } from '../observability/trace-execution.service';
import { AuditPdfService } from '../survival/audit-pdf.service';

@Controller('saas/audit')
export class SaaSAuditController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly traces: TraceExecutionService,
    private readonly pdf: AuditPdfService,
    private readonly policyEnforcement: PolicyEnforcementService,
    private readonly metrics: PrometheusMetricsService,
  ) {}

  @Get('export/:correlationId')
  @Header('Cache-Control', 'no-store')
  async export(@Param('correlationId') correlationId: string): Promise<StreamableFile> {
    this.metrics.incApiRequestsTotal('saas_audit', 'export_json');
    const started = Date.now();
    const tenantId = this.tenantContext.getRequired();
    try {
      this.policyEnforcement.enforceTenantOperation({
        tenantId,
        correlationId: `audit-export:${correlationId.trim()}`,
        operationType: 'READ',
        riskTier: 'MEDIUM',
      });
      const trace = await this.traces.traceExecution(tenantId, correlationId.trim());
      const filename = `collectiq-audit-${tenantId}-${correlationId}.json`;
      const buf = Buffer.from(JSON.stringify(trace, null, 2), 'utf8');
      return new StreamableFile(buf, {
        type: 'application/json; charset=utf-8',
        disposition: `attachment; filename="${filename}"`,
      });
    } catch (error) {
      this.metrics.incApiErrorsTotal('saas_audit', 'export_json', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('saas_audit', 'export_json', Date.now() - started);
    }
  }

  @Get('export-pdf/:correlationId')
  async exportPdf(@Param('correlationId') correlationId: string, @Res() res: Response): Promise<void> {
    this.metrics.incApiRequestsTotal('saas_audit', 'export_pdf');
    const started = Date.now();
    const tenantId = this.tenantContext.getRequired();
    try {
      this.policyEnforcement.enforceTenantOperation({
        tenantId,
        correlationId: `audit-export-pdf:${correlationId.trim()}`,
        operationType: 'READ',
        riskTier: 'MEDIUM',
      });
      const buf = await this.pdf.renderCaseAuditPdf(tenantId, correlationId.trim());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="collectiq-audit-${tenantId}-${correlationId.trim()}.pdf"`,
      );
      res.send(buf);
    } catch (error) {
      this.metrics.incApiErrorsTotal('saas_audit', 'export_pdf', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('saas_audit', 'export_pdf', Date.now() - started);
    }
  }

}
