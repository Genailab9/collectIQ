import { Controller, Get, Param, Query } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TransitionReadModelService } from '../modules/read-model/transition-read-model.service';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceExecutionService } from './trace-execution.service';
import type { ExecutionTraceDto } from './trace-execution.dto';

@Controller('observability')
export class ObservabilityController {
  constructor(
    private readonly traces: TraceExecutionService,
    private readonly tenantContext: TenantContextService,
    private readonly structured: StructuredLoggerService,
    private readonly readModel: TransitionReadModelService,
  ) {}

  @Get('summary')
  async summary() {
    const tenantId = this.tenantContext.getRequired();
    return this.readModel.observabilitySummary(tenantId);
  }

  /**
   * PRD §12 — returns transition log, decrypted SMEK audit payloads, and collected errors for the tenant + correlation.
   */
  @Get('trace/:correlationId')
  async getTrace(@Param('correlationId') correlationId: string): Promise<ExecutionTraceDto> {
    const tenantId = this.tenantContext.getRequired();
    return this.traces.traceExecution(tenantId, correlationId);
  }

  /** Phase 4 — bounded in-memory export; optional correlationId filter within the ring buffer. */
  @Get('structured-log-export')
  structuredExport(
    @Query('limit') limit?: string,
    @Query('correlationId') correlationId?: string,
  ) {
    this.tenantContext.getRequired();
    const lim = limit ? Number.parseInt(limit, 10) : 500;
    const rows = this.structured.exportRecentStructured(Number.isFinite(lim) ? lim : 500);
    const c = correlationId?.trim();
    if (!c) {
      return { events: rows };
    }
    return { events: rows.filter((e) => e.correlationId === c) };
  }
}
