import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { MachineKind } from '../../state-machine/types/machine-kind';

@Injectable()
export class CallTransitionQueryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
  ) {}

  /**
   * Latest CALL machine `toState` for a call correlation (PRD §3 — transition log is source of truth).
   */
  async getLatestCallToState(tenantId: string, correlationId: string): Promise<string | null> {
    const row = await this.transitions
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.correlationId = :correlationId', { correlationId })
      .andWhere('t.machine = :machine', { machine: MachineKind.CALL })
      .orderBy('t.occurredAt', 'DESC')
      .getOne();
    return row?.toState ?? null;
  }
}
