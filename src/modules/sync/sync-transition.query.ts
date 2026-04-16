import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { TenantQueryEngine } from '../../tenant/query-engines/tenant-query.engine';

@Injectable()
export class SyncTransitionQueryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    private readonly tenantQueryEngine: TenantQueryEngine,
  ) {}

  /**
   * Latest SYNC machine `toState` for a settlement key (paymentId stored as transition correlationId).
   */
  async getLatestSyncToState(tenantId: string, paymentId: string): Promise<string | null> {
    const row = await this.tenantQueryEngine.query(this.transitions, 't', tenantId, async (qb) =>
      qb
        .andWhere('t.correlationId = :paymentId', { paymentId })
        .andWhere('t.machine = :machine', { machine: MachineKind.SYNC })
        .orderBy('t.occurredAt', 'DESC')
        .getOne(),
    );
    return row?.toState ?? null;
  }
}
