import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { TraceExecutionService } from '../observability/trace-execution.service';

@Injectable()
export class AuditPdfService {
  constructor(private readonly traces: TraceExecutionService) {}

  async renderCaseAuditPdf(tenantId: string, correlationId: string): Promise<Buffer> {
    const trace = await this.traces.traceExecution(tenantId, correlationId);
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(16).text('CollectIQ — Case audit report', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Tenant: ${trace.tenantId}`);
    doc.text(`Correlation: ${trace.correlationId}`);
    doc.text(`Generated (UTC): ${new Date().toISOString()}`);
    doc.moveDown();

    doc.fontSize(12).text('State transitions', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const tr of trace.transitions) {
      doc.text(
        `${tr.occurredAt} | ${tr.machine} | ${tr.from} → ${tr.to} | actor=${tr.actor ?? 'n/a'}`,
        { width: 500 },
      );
      if (tr.metadataJson) {
        doc.fillColor('gray').text(`  metadata: ${tr.metadataJson.slice(0, 400)}`, { width: 500 });
        doc.fillColor('black');
      }
    }

    doc.moveDown();
    doc.fontSize(12).text('Orchestration / compliance-relevant audit rows', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const row of trace.adapterCalls) {
      doc.text(`${row.createdAt} | ${row.auditKind} | phase=${row.executionPhase}`);
      const snippet = JSON.stringify(row.payload).slice(0, 500);
      doc.fillColor('gray').text(`  ${snippet}`, { width: 500 });
      doc.fillColor('black');
    }

    if (trace.errors.length > 0) {
      doc.moveDown();
      doc.fontSize(12).text('Recorded errors', { underline: true });
      doc.fontSize(9);
      for (const er of trace.errors) {
        doc.text(`${er.at} [${er.source}] ${er.detail}`);
      }
    }

    doc.end();
    return done;
  }
}
