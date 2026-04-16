import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { ApprovalService } from './approval.service';
import { emitRuntimeProof } from '../../runtime-proof/runtime-proof-emitter';

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
    emitRuntimeProof({
      requirement_id: 'REQ-APR-003',
      event_type: 'WORKER_EXECUTION',
      tenant_id: 'n/a',
      metadata: { worker: 'ApprovalEscalationScheduler.escalateOverduePending', phase: 'start' },
    });
    const tenants = await this.approvals.listTenantsWithApprovalActivity();
    for (const tenantId of tenants) {
      const due = await this.tenantContext.run(tenantId, async () =>
        this.approvals.findDueEscalationsForTenant(tenantId),
      );
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
          emitRuntimeProof({
            requirement_id: 'REQ-APR-003',
            event_type: 'WORKER_EXECUTION',
            tenant_id: row.tenantId,
            metadata: {
              worker: 'ApprovalEscalationScheduler.escalateOverduePending',
              phase: 'error',
              correlationId: row.correlationId,
              message: String(cause),
            },
          });
        }
      }
    }
    emitRuntimeProof({
      requirement_id: 'REQ-APR-003',
      event_type: 'WORKER_EXECUTION',
      tenant_id: 'n/a',
      metadata: {
        worker: 'ApprovalEscalationScheduler.escalateOverduePending',
        phase: 'complete',
        tenantsScanned: tenants.length,
      },
    });
  }
}
