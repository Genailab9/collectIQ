import { Injectable, Optional } from '@nestjs/common';
import { NotificationOutboxService } from '../survival/notification-outbox.service';
import { TransitionLogPersistenceError } from './errors/state-machine.errors';
import type { TransitionProposal } from './types/transition-proposal';
import { TransitionEventLoggerQueryService } from './transition-event-logger.query';

@Injectable()
export class TransitionEventLoggerService {
  constructor(
    private readonly transitionLogQuery: TransitionEventLoggerQueryService,
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

    const row = this.transitionLogQuery.create({
      tenantId: proposal.tenantId,
      correlationId: proposal.correlationId,
      machine: proposal.machine,
      fromState: proposal.from,
      toState: proposal.to,
      actor: proposal.actor ?? null,
      metadataJson,
    });

    try {
      const saved = await this.transitionLogQuery.save(row);
      if (this.notifications) {
        void this.notifications.onPersistedTransition(saved).catch(() => undefined);
      }
    } catch (cause) {
      throw new TransitionLogPersistenceError(cause);
    }
  }
}
