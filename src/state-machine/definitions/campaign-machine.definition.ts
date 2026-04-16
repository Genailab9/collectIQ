import type { MachineDefinition } from '../machine-definition';
import { MachineKind } from '../types/machine-kind';

export const CampaignMachineState = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

const states = new Set<string>(Object.values(CampaignMachineState));
const terminalStates = new Set<string>([CampaignMachineState.CANCELLED]);

const transitions = new Map<string, ReadonlySet<string>>([
  [
    CampaignMachineState.DRAFT,
    new Set([CampaignMachineState.ACTIVE, CampaignMachineState.CANCELLED]) as ReadonlySet<string>,
  ],
  [
    CampaignMachineState.ACTIVE,
    new Set([
      CampaignMachineState.PAUSED,
      CampaignMachineState.COMPLETED,
      CampaignMachineState.CANCELLED,
    ]) as ReadonlySet<string>,
  ],
  [
    CampaignMachineState.PAUSED,
    new Set([CampaignMachineState.ACTIVE, CampaignMachineState.CANCELLED]) as ReadonlySet<string>,
  ],
  [
    CampaignMachineState.COMPLETED,
    new Set([CampaignMachineState.CANCELLED]) as ReadonlySet<string>,
  ],
]);

export const campaignMachineDefinition: MachineDefinition = {
  kind: MachineKind.CAMPAIGN,
  states,
  terminalStates,
  transitions,
};

