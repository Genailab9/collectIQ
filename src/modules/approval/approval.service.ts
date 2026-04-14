import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { requireSmekCompleted } from '../../kernel/smek-loop-result.guard';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { ApprovalTransitionQueryService } from './approval-transition-query.service';
import { computePendingDeadline } from './approval-policy.rules';
import {
  ApprovalOfferInvalidError,
  ApprovalStateConflictError,
  ApprovalTransitionNotAllowedError,
} from './approval.errors';
import type { OfficerDecisionType } from './approval.types';
import { TenantApprovalPolicyEntity } from './entities/tenant-approval-policy.entity';

const TERMINAL = new Set<string>([
  ApprovalMachineState.APPROVED,
  ApprovalMachineState.REJECTED,
]);

/**
 * PRD v1.1 §5 / §7 — no approval projection; policy banding runs only inside SMEK via `ApprovalAdapter.evaluateApproval`.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly smekKernel: SmekKernelService,
    private readonly approvalTransitions: ApprovalTransitionQueryService,
    @InjectRepository(TenantApprovalPolicyEntity)
    private readonly policies: Repository<TenantApprovalPolicyEntity>,
  ) {}

  async getState(
    tenantId: string,
    correlationId: string,
  ): Promise<{ latestApprovalState: string | null }> {
    const latestApprovalState = await this.approvalTransitions.getLatestApprovalToState(
      tenantId,
      correlationId,
    );
    return { latestApprovalState };
  }

  async registerSettlementApprovalRequest(params: {
    tenantId: string;
    correlationId: string;
    offerAmountCents: number;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<{ toState: string; route: 'AUTO_APPROVE' | 'MANUAL_REVIEW' }> {
    if (!Number.isFinite(params.offerAmountCents) || !Number.isInteger(params.offerAmountCents)) {
      throw new ApprovalOfferInvalidError('offerAmountCents must be a finite integer (cents).');
    }
    const latest = await this.approvalTransitions.getLatestApprovalToState(
      params.tenantId,
      params.correlationId,
    );
    if (latest !== null && !TERMINAL.has(latest)) {
      throw new ApprovalStateConflictError(
        `An approval case is already in progress for correlation "${params.correlationId}".`,
      );
    }
    if (latest !== null && TERMINAL.has(latest)) {
      throw new ApprovalStateConflictError(
        `Approval is already terminal (${latest}) for correlation "${params.correlationId}".`,
      );
    }

    await this.policies.findOneOrFail({ where: { tenantId: params.tenantId } });

    const result = requireSmekCompleted(
      await this.smekKernel.executeLoop({
      phase: ExecutionLoopPhase.APPROVE,
      transition: {
        tenantId: params.tenantId,
        correlationId: params.correlationId,
        machine: MachineKind.APPROVAL,
        from: ApprovalMachineState.REQUESTED,
        to: ApprovalMachineState.PENDING,
        actor: 'policy-engine',
        metadata: {
          offerAmountCents: params.offerAmountCents,
        },
      },
      adapterEnvelope: null,
      complianceGate: {
        tenantId: params.tenantId,
        correlationId: params.correlationId,
        executionPhase: ExecutionLoopPhase.APPROVE,
        borrowerOptedOut: params.borrowerOptedOut,
      },
      approvalIngress: { source: 'INTERNAL_POLICY' },
      approvalPolicyEvaluation: { offerAmountCents: params.offerAmountCents },
      idempotency: {
        key: params.idempotencyKey,
        step: IdempotencyStep.ApprovalRegister,
      },
    }),
      (m) => new ApprovalStateConflictError(m),
    );

    const route = result.resolvedApprovalPolicy?.route;
    if (!route) {
      throw new ApprovalStateConflictError('SMEK did not return resolved approval policy metadata.');
    }

    const toState =
      route === 'AUTO_APPROVE' ? ApprovalMachineState.APPROVED : ApprovalMachineState.PENDING;

    return { toState, route };
  }

  async submitOfficerDecision(params: {
    tenantId: string;
    correlationId: string;
    fromState: string;
    decision: OfficerDecisionType;
    officerId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<{ toState: string }> {
    const latest = await this.approvalTransitions.getLatestApprovalToState(
      params.tenantId,
      params.correlationId,
    );
    if (latest !== params.fromState) {
      throw new ApprovalTransitionNotAllowedError(
        `fromState mismatch: expected "${params.fromState}" but latest is "${String(latest)}".`,
      );
    }

    const toState = mapOfficerDecisionToTargetState(params.fromState, params.decision);
    if (!toState) {
      throw new ApprovalTransitionNotAllowedError(
        `Decision "${params.decision}" is not permitted from "${params.fromState}".`,
      );
    }

    const metadata: Record<string, unknown> = {
      officerDecision: params.decision,
    };
    if (toState === ApprovalMachineState.PENDING) {
      const policy = await this.policies.findOne({ where: { tenantId: params.tenantId } });
      if (policy) {
        metadata.escalationDeadlineAt = computePendingDeadline(new Date(), policy).toISOString();
      }
    }

    requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.APPROVE,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          machine: MachineKind.APPROVAL,
          from: params.fromState,
          to: toState,
          actor: params.officerId,
          metadata,
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          executionPhase: ExecutionLoopPhase.APPROVE,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        approvalIngress: { source: 'OFFICER_API' },
        idempotency: {
          key: params.idempotencyKey,
          step: IdempotencyStep.ApprovalOfficerDecision,
        },
      }),
      (m) => new ApprovalStateConflictError(m),
    );

    return { toState };
  }

  async escalateDueCase(params: {
    tenantId: string;
    correlationId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const latest = await this.approvalTransitions.getLatestApprovalToState(
      params.tenantId,
      params.correlationId,
    );
    if (latest !== ApprovalMachineState.PENDING) {
      throw new ApprovalTransitionNotAllowedError(
        `Cannot escalate: latest approval state is "${String(latest)}", expected PENDING.`,
      );
    }

    requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.APPROVE,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          machine: MachineKind.APPROVAL,
          from: ApprovalMachineState.PENDING,
          to: ApprovalMachineState.TIMEOUT,
          actor: 'escalation-timer',
          metadata: { reason: 'pending_timeout' },
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          executionPhase: ExecutionLoopPhase.APPROVE,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        approvalIngress: { source: 'ESCALATION_TIMER' },
        idempotency: {
          key: params.idempotencyKey,
          step: IdempotencyStep.ApprovalEscalationTimer,
        },
      }),
      (m) => new ApprovalStateConflictError(m),
    );
  }

  async findDueEscalations(limit = 50): Promise<{ tenantId: string; correlationId: string }[]> {
    return this.approvalTransitions.findDueEscalations(new Date(), 8000, limit);
  }
}

function mapOfficerDecisionToTargetState(
  fromState: string,
  decision: OfficerDecisionType,
): string | null {
  if (fromState === ApprovalMachineState.PENDING) {
    if (decision === 'APPROVE') return ApprovalMachineState.APPROVED;
    if (decision === 'REJECT') return ApprovalMachineState.REJECTED;
    if (decision === 'COUNTER') return ApprovalMachineState.COUNTERED;
    return null;
  }
  if (fromState === ApprovalMachineState.TIMEOUT || fromState === ApprovalMachineState.ESCALATED) {
    if (decision === 'APPROVE') return ApprovalMachineState.APPROVED;
    if (decision === 'REJECT') return ApprovalMachineState.REJECTED;
    if (decision === 'COUNTER') return null;
    return null;
  }
  return null;
}
