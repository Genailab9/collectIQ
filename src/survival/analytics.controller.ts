import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AnalyticsService } from './analytics.service';
import { AuditPdfService } from './audit-pdf.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly analytics: AnalyticsService,
    private readonly pdf: AuditPdfService,
  ) {}

  @Get('dashboard')
  async dashboard(@Query('days') days?: string) {
    const tenantId = this.tenantContext.getRequired();
    const d = days ? Number.parseInt(days, 10) : 30;
    return this.analytics.dashboard(tenantId, Number.isFinite(d) ? d : 30);
  }

  @Get('campaign/:id')
  async campaign(@Param('id') id: string) {
    const tenantId = this.tenantContext.getRequired();
    return this.analytics.campaign(tenantId, id);
  }

  @Get('case/:correlationId')
  async case(@Param('correlationId') correlationId: string) {
    const tenantId = this.tenantContext.getRequired();
    return this.analytics.caseTruth(tenantId, correlationId);
  }

  @Get('case/:correlationId/audit.pdf')
  async casePdf(@Param('correlationId') correlationId: string, @Res() res: Response): Promise<void> {
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
