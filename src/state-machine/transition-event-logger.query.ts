import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StateTransitionLogEntity } from './entities/state-transition-log.entity';

@Injectable()
export class TransitionEventLoggerQueryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly logs: Repository<StateTransitionLogEntity>,
  ) {}

  create(row: Partial<StateTransitionLogEntity>): StateTransitionLogEntity {
    return this.logs.create(row);
  }

  save(row: StateTransitionLogEntity): Promise<StateTransitionLogEntity> {
    return this.logs.save(row);
  }
}
