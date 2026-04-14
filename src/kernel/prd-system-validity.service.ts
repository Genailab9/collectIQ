import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MachineRegistryService } from '../state-machine/machine-registry.service';
import { MachineKind } from '../state-machine/types/machine-kind';

const REQUIRED_MACHINES: readonly MachineKind[] = [
  MachineKind.DATA,
  MachineKind.CALL,
  MachineKind.APPROVAL,
  MachineKind.PAYMENT,
  MachineKind.SYNC,
] as const;

/**
 * PRD v1.1 §13 — post-bootstrap checks that the execution kernel can rely on a sealed five-machine registry.
 * Shape rules are enforced earlier by `MachineRegistryService.validateDefinitionShape` during registration.
 */
@Injectable()
export class PrdSystemValidityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrdSystemValidityService.name);

  constructor(private readonly machines: MachineRegistryService) {}

  onApplicationBootstrap(): void {
    this.assertSealedRegistry();
    this.assertExactMachineSurface();
    this.logger.log('PRD v1.1 §13 system validity checks passed (sealed registry + required machines).');
  }

  private assertSealedRegistry(): void {
    if (!this.machines.isSealed()) {
      throw new Error('PRD §13: state machine registry is not sealed; SMEK cannot be authoritative.');
    }
  }

  private assertExactMachineSurface(): void {
    const present = new Set(this.machines.listKinds());
    if (present.size !== REQUIRED_MACHINES.length) {
      throw new Error(
        `PRD §13: expected ${REQUIRED_MACHINES.length} registered machines (DATA+CALL+APPROVAL+PAYMENT+SYNC), found ${present.size} (${[
          ...present,
        ].join(', ')}).`,
      );
    }
    for (const kind of REQUIRED_MACHINES) {
      if (!present.has(kind)) {
        throw new Error(`PRD §13: missing required machine "${kind}".`);
      }
    }
  }
}
