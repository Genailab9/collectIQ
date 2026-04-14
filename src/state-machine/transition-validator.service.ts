import { Injectable } from '@nestjs/common';
import {
  IllegalStateTransitionError,
  NoopTransitionError,
  StateMachineNotReadyError,
  TerminalStateViolationError,
  UnknownMachineError,
  UnknownStateError,
} from './errors/state-machine.errors';
import { MachineRegistryService } from './machine-registry.service';
import type { TransitionProposal } from './types/transition-proposal';

@Injectable()
export class TransitionValidatorService {
  constructor(private readonly registry: MachineRegistryService) {}

  assertValidTransition(proposal: TransitionProposal): void {
    if (!this.registry.isSealed()) {
      throw new StateMachineNotReadyError();
    }

    const { machine, from, to } = proposal;
    if (from === to) {
      throw new NoopTransitionError(machine, from);
    }

    if (!this.registry.has(machine)) {
      throw new UnknownMachineError(machine);
    }
    const definition = this.registry.getDefinition(machine);

    if (!definition.states.has(from)) {
      throw new UnknownStateError(machine, from);
    }
    if (!definition.states.has(to)) {
      throw new UnknownStateError(machine, to);
    }
    if (definition.terminalStates.has(from)) {
      throw new TerminalStateViolationError(machine, from, to);
    }

    const allowed = definition.transitions.get(from);
    if (!allowed || !allowed.has(to)) {
      throw new IllegalStateTransitionError(machine, from, to);
    }
  }
}
