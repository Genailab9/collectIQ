import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { accountMachineDefinition } from './definitions/account-machine.definition';
import { approvalMachineDefinition } from './definitions/approval-machine.definition';
import { callMachineDefinition } from './definitions/call-machine.definition';
import { campaignMachineDefinition } from './definitions/campaign-machine.definition';
import { dataMachineDefinition } from './definitions/data-machine.definition';
import { paymentMachineDefinition } from './definitions/payment-machine.definition';
import { syncMachineDefinition } from './definitions/sync-machine.definition';
import type { MachineDefinition } from './machine-definition';
import { MachineKind } from './types/machine-kind';

@Injectable()
export class MachineRegistryService implements OnModuleInit {
  private readonly logger = new Logger(MachineRegistryService.name);
  private readonly definitions = new Map<MachineKind, MachineDefinition>();
  private sealed = false;

  onModuleInit(): void {
    this.logger.log(
      'Bootstrapping state machine registry (DATA, CALL, APPROVAL, PAYMENT, SYNC, ACCOUNT, CAMPAIGN).',
    );
    this.register(dataMachineDefinition);
    this.register(callMachineDefinition);
    this.register(approvalMachineDefinition);
    this.register(paymentMachineDefinition);
    this.register(syncMachineDefinition);
    this.register(accountMachineDefinition);
    this.register(campaignMachineDefinition);
    this.seal();
    this.logger.log('State machine registry sealed.');
  }

  register(definition: MachineDefinition): void {
    if (this.sealed) {
      throw new Error(
        `Machine registry is sealed; cannot register machine "${definition.kind}".`,
      );
    }
    if (this.definitions.has(definition.kind)) {
      throw new Error(`Duplicate machine registration for "${definition.kind}".`);
    }
    this.validateDefinitionShape(definition);
    this.definitions.set(definition.kind, definition);
  }

  has(kind: MachineKind): boolean {
    return this.definitions.has(kind);
  }

  seal(): void {
    if (this.sealed) {
      throw new Error('Machine registry is already sealed.');
    }
    const required = [
      MachineKind.DATA,
      MachineKind.CALL,
      MachineKind.APPROVAL,
      MachineKind.PAYMENT,
      MachineKind.SYNC,
      MachineKind.ACCOUNT,
      MachineKind.CAMPAIGN,
    ] as const;
    for (const kind of required) {
      if (!this.definitions.has(kind)) {
        throw new Error(`Machine registry cannot seal: missing machine "${kind}".`);
      }
    }
    this.sealed = true;
  }

  isSealed(): boolean {
    return this.sealed;
  }

  getDefinition(kind: MachineKind): MachineDefinition {
    const def = this.definitions.get(kind);
    if (!def) {
      throw new Error(`Machine "${kind}" is not registered.`);
    }
    return def;
  }

  listKinds(): MachineKind[] {
    return [...this.definitions.keys()];
  }

  private validateDefinitionShape(definition: MachineDefinition): void {
    for (const state of definition.states) {
      if (!definition.transitions.has(state) && !definition.terminalStates.has(state)) {
        throw new Error(
          `Invalid machine "${definition.kind}": state "${state}" must be terminal or have outgoing transitions.`,
        );
      }
    }
    for (const state of definition.terminalStates) {
      if (!definition.states.has(state)) {
        throw new Error(
          `Invalid machine "${definition.kind}": terminal "${state}" is not a declared state.`,
        );
      }
      if (definition.transitions.has(state)) {
        throw new Error(
          `Invalid machine "${definition.kind}": terminal "${state}" must not define outgoing transitions.`,
        );
      }
    }
    for (const [from, targets] of definition.transitions) {
      if (!definition.states.has(from)) {
        throw new Error(
          `Invalid machine "${definition.kind}": transition source "${from}" is not a declared state.`,
        );
      }
      if (definition.terminalStates.has(from)) {
        throw new Error(
          `Invalid machine "${definition.kind}": source "${from}" cannot be terminal and have outgoing transitions.`,
        );
      }
      for (const to of targets) {
        if (!definition.states.has(to)) {
          throw new Error(
            `Invalid machine "${definition.kind}": transition target "${to}" from "${from}" is not a declared state.`,
          );
        }
      }
    }
  }
}
