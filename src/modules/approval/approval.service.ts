import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallTransitionQueryService } from '../../adapters/telephony/call-transition-query.service';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { requireSmekCompleted } from '../../kernel/smek-loop-result.guard';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { CallMachineState } from '../../state-machine/definitions/call-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { ApprovalTransitionQueryService } from './approval-transition.query';
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
    private readonly callTransitions: CallTransitionQueryService,
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
    counterOfferAmountCents?: number;
  }): Promise<{ toState: string }> {
    const latest = await this.approvalTransitions.getLatestApprovalToState(
      params.tenantId,
      params.correlationId,
    );
    const fromState = normalizeApprovalState(params.fromState);
    if (latest !== fromState) {
      throw new ApprovalTransitionNotAllowedError(
        `fromState mismatch: expected "${fromState}" but latest is "${String(latest)}".`,
      );
    }

    const toState = mapOfficerDecisionToTargetState(fromState, params.decision);
    if (!toState) {
      throw new ApprovalTransitionNotAllowedError(
        `Decision "${params.decision}" is not permitted from "${fromState}".`,
      );
    }

    const metadata: Record<string, unknown> = {
      officerDecision: params.decision,
    };
    if (params.decision === 'COUNTER') {
      if (
        !Number.isFinite(params.counterOfferAmountCents) ||
        !Number.isInteger(params.counterOfferAmountCents) ||
        (params.counterOfferAmountCents ?? 0) <= 0
      ) {
        throw new ApprovalOfferInvalidError(
          'counterOfferAmountCents is required and must be a positive integer for COUNTER decisions.',
        );
      }
      metadata.counterOfferAmountCents = params.counterOfferAmountCents;
      metadata.offerAmountCents = params.counterOfferAmountCents;
    }
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

    if (toState === ApprovalMachineState.COUNTERED) {
      await this.reopenNegotiationAfterCounter(params);
    }

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

  async listTenantsWithApprovalActivity(): Promise<string[]> {
    return this.approvalTransitions.listTenantsWithApprovalActivity();
  }

  async findDueEscalationsForTenant(
    tenantId: string,
    limit = 50,
  ): Promise<{ tenantId: string; correlationId: string }[]> {
    return this.approvalTransitions.findDueEscalationsForTenant(tenantId, new Date(), 500, limit);
  }
  private async reopenNegotiationAfterCounter(params: {
    tenantId: string;
    correlationId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const latestCall = await this.callTransitions.getLatestCallToState(params.tenantId, params.correlationId);
    if (latestCall !== CallMachineState.WAITING_APPROVAL) {
      return;
    }
    requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.CALL,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          machine: MachineKind.CALL,
          from: CallMachineState.WAITING_APPROVAL,
          to: CallMachineState.NEGOTIATING,
          actor: 'approval.counter',
          metadata: { source: 'officer_counter_offer' },
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.correlationId,
          executionPhase: ExecutionLoopPhase.CALL,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        telephonyIngress: { source: 'INTERNAL_COUNTER_OFFER' },
        idempotency: {
          key: `${params.idempotencyKey}:counter-reopen`,
          step: IdempotencyStep.ApprovalCounterReopenNegotiation,
        },
      }),
      (m) => new ApprovalStateConflictError(m),
    );
  }
}

function mapOfficerDecisionToTargetState(
  fromState: string,
  decision: OfficerDecisionType,
): string | null {
  if (fromState === ApprovalMachineState.REQUESTED) {
    if (decision === 'APPROVE') return ApprovalMachineState.APPROVED;
    if (decision === 'COUNTER') return ApprovalMachineState.COUNTERED;
    return null;
  }
  if (fromState === ApprovalMachineState.PENDING) {
    if (decision === 'APPROVE') return ApprovalMachineState.APPROVED;
    if (decision === 'REJECT') return ApprovalMachineState.REJECTED;
    if (decision === 'COUNTER') return ApprovalMachineState.COUNTERED;
    return null;
  }
  if (fromState === ApprovalMachineState.COUNTERED) {
    if (decision === 'APPROVE') return ApprovalMachineState.APPROVED;
    if (decision === 'REJECT') return ApprovalMachineState.REJECTED;
    if (decision === 'COUNTER') return ApprovalMachineState.PENDING;
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

function normalizeApprovalState(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'COUNTER') {
    return ApprovalMachineState.COUNTERED;
  }
  return normalized;
}
