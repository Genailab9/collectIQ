import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../../state-machine/types/machine-kind';

@Injectable()
export class ApprovalTransitionQueryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
  ) {}

  /**
   * Latest persisted APPROVAL machine state for a correlation, or null if none.
   */
  async getLatestApprovalToState(tenantId: string, correlationId: string): Promise<string | null> {
    const row = await this.transitions
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.correlationId = :correlationId', { correlationId })
      .andWhere('t.machine = :machine', { machine: MachineKind.APPROVAL })
      .orderBy('t.occurredAt', 'DESC')
      .getOne();
    return row?.toState ?? null;
  }

  /**
   * PRD v1.1 §5 — escalation candidates from transition log only (latest APPROVAL row per correlation).
   * Requires `escalationDeadlineAt` ISO metadata on the PENDING transition row.
   */
  async findDueEscalations(now: Date, scanLimit = 8000, resultLimit = 50): Promise<
    { tenantId: string; correlationId: string }[]
  > {
    const rows = await this.transitions
      .createQueryBuilder('t')
      .where('t.machine = :machine', { machine: MachineKind.APPROVAL })
      .orderBy('t.occurredAt', 'DESC')
      .take(scanLimit)
      .getMany();

    const latestByTenantCorrelation = new Map<string, StateTransitionLogEntity>();
    for (const r of rows) {
      const key = `${r.tenantId}\t${r.correlationId}`;
      if (!latestByTenantCorrelation.has(key)) {
        latestByTenantCorrelation.set(key, r);
      }
    }

    const nowMs = now.getTime();
    const due: { tenantId: string; correlationId: string }[] = [];
    for (const r of latestByTenantCorrelation.values()) {
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
