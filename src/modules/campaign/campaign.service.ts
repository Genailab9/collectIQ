import { Injectable, NotFoundException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { isSmekComplianceBlocked } from '../../kernel/smek-kernel.dto';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { CampaignMachineState } from '../../state-machine/definitions/campaign-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { CampaignEntity } from './campaign.entity';
import { CampaignQueryService } from './campaign.query';

@Injectable()
export class CampaignService {
  constructor(
    private readonly campaignQuery: CampaignQueryService,
    private readonly smekKernel: SmekKernelService,
  ) {}

  async create(tenantId: string, input: { name: string; description?: string | null }): Promise<CampaignEntity> {
    const t = tenantId.trim();
    const row = this.campaignQuery.create({
      id: randomUUID(),
      tenantId: t,
      name: input.name.trim().slice(0, 512),
      description: input.description?.trim() ? input.description.trim().slice(0, 4000) : null,
      status: CampaignMachineState.DRAFT,
    });
    const saved = await this.campaignQuery.save(row);

    const result = await this.smekKernel.executeLoop({
      phase: ExecutionLoopPhase.CAMPAIGN,
      transition: {
        tenantId: t,
        correlationId: saved.id,
        machine: MachineKind.CAMPAIGN,
        from: CampaignMachineState.DRAFT,
        to: CampaignMachineState.ACTIVE,
        actor: 'campaign.create',
        metadata: { campaignId: saved.id, name: saved.name },
      },
      adapterEnvelope: null,
      complianceGate: {
        tenantId: t,
        correlationId: saved.id,
        executionPhase: ExecutionLoopPhase.CAMPAIGN,
        borrowerOptedOut: false,
      },
      idempotency: {
        key: `campaign:activate:${saved.id}`,
        step: IdempotencyStep.CampaignActivate,
      },
    });

    if (isSmekComplianceBlocked(result)) {
      throw new ForbiddenException({
        outcome: result.outcome,
        blockCode: result.blockCode,
        message: result.message,
      });
    }

    saved.status = CampaignMachineState.ACTIVE;
    return this.campaignQuery.save(saved);
  }

  async list(tenantId: string): Promise<CampaignEntity[]> {
    return this.campaignQuery.listByTenant(tenantId.trim());
  }

  async getById(tenantId: string, id: string): Promise<CampaignEntity> {
    const row = await this.campaignQuery.findByIdForTenant(tenantId.trim(), id.trim());
    if (!row) {
      throw new NotFoundException('Campaign not found.');
    }
    return row;
  }

  async assertActiveForTenant(tenantId: string, campaignId: string): Promise<void> {
    const row = await this.campaignQuery.findActiveByIdForTenant(tenantId.trim(), campaignId.trim());
    if (!row) {
      throw new NotFoundException('Campaign not found or not active for this tenant.');
    }
  }
}
