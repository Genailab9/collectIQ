import { Controller, Get, Header, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TraceExecutionService } from '../observability/trace-execution.service';
import { AuditPdfService } from '../survival/audit-pdf.service';

@Controller('saas/audit')
export class SaaSAuditController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly traces: TraceExecutionService,
    private readonly pdf: AuditPdfService,
  ) {}

  @Get('export/:correlationId')
  @Header('Cache-Control', 'no-store')
  async export(@Param('correlationId') correlationId: string): Promise<StreamableFile> {
    const tenantId = this.tenantContext.getRequired();
    const trace = await this.traces.traceExecution(tenantId, correlationId.trim());
    const filename = `collectiq-audit-${tenantId}-${correlationId}.json`;
    const buf = Buffer.from(JSON.stringify(trace, null, 2), 'utf8');
    return new StreamableFile(buf, {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('export-pdf/:correlationId')
  async exportPdf(@Param('correlationId') correlationId: string, @Res() res: Response): Promise<void> {
    const tenantId = this.tenantContext.getRequired();
    const buf = await this.pdf.renderCaseAuditPdf(tenantId, correlationId.trim());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="collectiq-audit-${tenantId}-${correlationId.trim()}.pdf"`,
    );
    res.send(buf);
  }
}
