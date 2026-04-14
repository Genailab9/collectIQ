import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { ApprovalService } from './approval.service';

/** PRD §2.2 — tick-driven batch only; each row is advanced exclusively via `ApprovalService` → SMEK. */
@Injectable()
export class ApprovalEscalationScheduler {
  private readonly logger = new Logger(ApprovalEscalationScheduler.name);

  constructor(
    private readonly approvals: ApprovalService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async escalateOverduePending(): Promise<void> {
    const due = await this.approvals.findDueEscalations();
    for (const row of due) {
      try {
        await this.tenantContext.run(row.tenantId, async () => {
          await this.approvals.escalateDueCase({
            tenantId: row.tenantId,
            correlationId: row.correlationId,
            idempotencyKey: `approval.escalation:${row.tenantId}:${row.correlationId}`,
          });
        });
      } catch (cause) {
        this.logger.warn(
          `Escalation skipped for tenant=${row.tenantId} correlation=${row.correlationId}: ${String(cause)}`,
        );
      }
    }
  }
}
