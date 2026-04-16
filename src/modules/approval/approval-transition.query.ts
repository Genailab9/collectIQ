import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { AdminQueryEngine } from '../../tenant/query-engines/admin-query.engine';
import { TenantQueryEngine } from '../../tenant/query-engines/tenant-query.engine';

@Injectable()
export class ApprovalTransitionQueryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    private readonly tenantQueryEngine: TenantQueryEngine,
    private readonly adminQueryEngine: AdminQueryEngine,
  ) {}

  /**
   * Latest persisted APPROVAL machine state for a correlation, or null if none.
   */
  async getLatestApprovalToState(tenantId: string, correlationId: string): Promise<string | null> {
    const row = await this.tenantQueryEngine.query(this.transitions, 't', tenantId, async (qb) =>
      qb
        .andWhere('t.correlationId = :correlationId', { correlationId })
        .andWhere('t.machine = :machine', { machine: MachineKind.APPROVAL })
        .orderBy('t.occurredAt', 'DESC')
        .getOne(),
    );
    return row?.toState ?? null;
  }

  /**
   * Returns tenant ids that currently have approval transitions.
   */
  async listTenantsWithApprovalActivity(scanLimit = 2000): Promise<string[]> {
    const rows = await this.adminQueryEngine.query('kernel.escalation.scan', this.transitions, 't', async (qb) =>
      qb
        .select('DISTINCT t.tenantId', 'tenantId')
        .where('t.machine = :machine', { machine: MachineKind.APPROVAL })
        .orderBy('t.tenantId', 'ASC')
        .take(scanLimit)
        .getRawMany<{ tenantId: string }>(),
    );
    return rows.map((r) => r.tenantId).filter((x) => typeof x === 'string' && x.trim().length > 0);
  }

  /**
   * PRD v1.1 §5 — escalation candidates from transition log only (latest APPROVAL row per correlation).
   * Requires `escalationDeadlineAt` ISO metadata on the PENDING transition row.
   */
  async findDueEscalationsForTenant(
    tenantId: string,
    now: Date,
    scanLimit = 500,
    resultLimit = 50,
  ): Promise<{ tenantId: string; correlationId: string }[]> {
    const rows = await this.tenantQueryEngine.query(this.transitions, 't', tenantId, async (qb) =>
      qb
        .andWhere('t.machine = :machine', { machine: MachineKind.APPROVAL })
        .orderBy('t.occurredAt', 'DESC')
        .take(scanLimit)
        .getMany(),
    );

    const latestByCorrelation = new Map<string, StateTransitionLogEntity>();
    for (const r of rows) {
      if (!latestByCorrelation.has(r.correlationId)) {
        latestByCorrelation.set(r.correlationId, r);
      }
    }

    const nowMs = now.getTime();
    const due: { tenantId: string; correlationId: string }[] = [];
    for (const r of latestByCorrelation.values()) {
      if (r.toState !== ApprovalMachineState.PENDING || !r.metadataJson) {
        continue;
      }
      let deadlineIso: string | undefined;
      try {
        deadlineIso = (JSON.parse(r.metadataJson) as { escalationDeadlineAt?: string })
          .escalationDeadlineAt;
      } catch {
        continue;
      }
      if (!deadlineIso) {
        continue;
      }
      if (new Date(deadlineIso).getTime() <= nowMs) {
        due.push({ tenantId: r.tenantId, correlationId: r.correlationId });
      }
    }

    due.sort((a, b) => {
      const c = a.tenantId.localeCompare(b.tenantId);
      return c !== 0 ? c : a.correlationId.localeCompare(b.correlationId);
    });
    return due.slice(0, resultLimit);
  }
}
