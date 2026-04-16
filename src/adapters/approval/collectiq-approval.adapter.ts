import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import type { ApprovalPolicyAdapterResult } from '../../contracts/approval-policy.types';
import { SmekApprovalAdapterEnvelopeDisallowedError } from '../../kernel/smek-kernel.errors';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { TenantApprovalPolicyEntity } from '../../modules/approval/entities/tenant-approval-policy.entity';
import { ApprovalPolicyMissingError } from '../../modules/approval/approval.errors';
import {
  assertOfferWithinTenantPolicyBounds,
  computePendingDeadline,
  routeOfferAgainstBand,
} from '../../modules/approval/approval-policy.rules';
import type { ApprovalAdapter } from '../interfaces/approval-adapter.interface';
import { ExecutionFeatureFlagsService } from '../../modules/tenant-feature-flags/execution-feature-flags.service';

/**
 * PRD v1.1 §7.1 — policy evaluation runs only when SMEK invokes `evaluateApproval`.
 * Envelope-based APPROVE execution remains disabled (ingress-only transitions).
 */
@Injectable()
export class CollectiqApprovalAdapter implements ApprovalAdapter {
  constructor(
    @InjectRepository(TenantApprovalPolicyEntity)
    private readonly policies: Repository<TenantApprovalPolicyEntity>,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  async evaluateApproval(input: {
    tenantId: string;
    offerAmountCents: number;
  }): Promise<ApprovalPolicyAdapterResult> {
    return this.evaluateApprovalCore(input);
  }

  private async evaluateApprovalCore(input: {
    tenantId: string;
    offerAmountCents: number;
  }): Promise<ApprovalPolicyAdapterResult> {
    const policy = await this.policies.findOne({ where: { tenantId: input.tenantId } });
    if (!policy) {
      throw new ApprovalPolicyMissingError(input.tenantId);
    }

    if (await this.executionFlags.isJsonTruthy(input.tenantId, 'SIMULATE_APPROVAL_TIMEOUT')) {
      return {
        route: 'MANUAL_REVIEW',
        toState: ApprovalMachineState.TIMEOUT,
        escalationDeadlineAtIso: null,
      };
    }

    assertOfferWithinTenantPolicyBounds(policy, input.offerAmountCents);
    const route = routeOfferAgainstBand(policy, input.offerAmountCents);

    const toState =
      route === 'AUTO_APPROVE' ? ApprovalMachineState.APPROVED : ApprovalMachineState.PENDING;

    const escalationDeadlineAtIso =
      toState === ApprovalMachineState.PENDING
        ? computePendingDeadline(new Date(), policy).toISOString()
        : null;

    return { route, toState, escalationDeadlineAtIso };
  }

  async execute(_envelope: AdapterEnvelope): Promise<unknown> {
    throw new SmekApprovalAdapterEnvelopeDisallowedError();
  }
}
