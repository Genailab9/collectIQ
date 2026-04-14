import { Injectable } from '@nestjs/common';
import type { StateMachineEngine } from './state-machine.interface';
import { MachineRegistryService } from './machine-registry.service';
import { TransitionEventLoggerService } from './transition-event-logger.service';
import { TransitionValidatorService } from './transition-validator.service';
import type { MachineKind } from './types/machine-kind';
import type { TransitionProposal } from './types/transition-proposal';

@Injectable()
export class StateMachineService implements StateMachineEngine {
  constructor(
    private readonly registry: MachineRegistryService,
    private readonly validator: TransitionValidatorService,
    private readonly transitionLogger: TransitionEventLoggerService,
  ) {}

  isEngineReady(): boolean {
    return this.registry.isSealed();
  }

  assertTransitionAllowed(proposal: TransitionProposal): void {
    this.validator.assertValidTransition(proposal);
  }

  /**
   * Validates then persists an append-only transition audit record.
   * Persistence failures surface as `TransitionLogPersistenceError` (never swallowed).
   */
  async recordValidatedTransition(proposal: TransitionProposal): Promise<void> {
    this.validator.assertValidTransition(proposal);
    await this.transitionLogger.append(proposal);
  }

  listRegisteredMachines(): MachineKind[] {
    if (!this.registry.isSealed()) {
      return [];
    }
    return this.registry.listKinds();
  }
}
