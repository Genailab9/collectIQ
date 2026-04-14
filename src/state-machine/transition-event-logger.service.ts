import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationOutboxService } from '../survival/notification-outbox.service';
import { TransitionLogPersistenceError } from './errors/state-machine.errors';
import { StateTransitionLogEntity } from './entities/state-transition-log.entity';
import type { TransitionProposal } from './types/transition-proposal';

@Injectable()
export class TransitionEventLoggerService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly logs: Repository<StateTransitionLogEntity>,
    @Optional() private readonly notifications?: NotificationOutboxService,
  ) {}

  async append(proposal: TransitionProposal): Promise<void> {
    let metadataJson: string | null = null;
    if (proposal.metadata !== undefined) {
      try {
        metadataJson = JSON.stringify(proposal.metadata);
      } catch (cause) {
        throw new TransitionLogPersistenceError(cause);
      }
    }

    const row = this.logs.create({
      tenantId: proposal.tenantId,
      correlationId: proposal.correlationId,
      machine: proposal.machine,
      fromState: proposal.from,
      toState: proposal.to,
      actor: proposal.actor ?? null,
      metadataJson,
    });

    try {
      const saved = await this.logs.save(row);
      if (this.notifications) {
        void this.notifications.onPersistedTransition(saved).catch(() => undefined);
      }
    } catch (cause) {
      throw new TransitionLogPersistenceError(cause);
    }
  }
}
