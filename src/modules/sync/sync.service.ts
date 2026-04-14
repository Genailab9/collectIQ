import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { SyncCommandKind } from '../../contracts/sync-command-kind';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { requireSmekCompleted } from '../../kernel/smek-loop-result.guard';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { SyncMachineState } from '../../state-machine/definitions/sync-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { SyncCaseSnapshotEntity } from './entities/sync-case-snapshot.entity';
import { SyncStateConflictError } from './sync.errors';
import { SyncTransitionQueryService } from './sync-transition-query.service';

const TERMINAL = new Set<string>([SyncMachineState.COMPLETED]);

/**
 * PRD strict post-payment sync — three SMEK-backed steps:
 * 1. Bootstrap (NOT_STARTED→IN_FLIGHT)
 * 2. Finalize case: outbound adapter (IN_FLIGHT→CASE_FINALIZED) + snapshot persistence
 * 3. `sync.completed`: CASE_FINALIZED→COMPLETED (ingress-only; kernel emits orchestration audit)
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly smekKernel: SmekKernelService,
    private readonly syncTransitions: SyncTransitionQueryService,
    @InjectRepository(SyncCaseSnapshotEntity)
    private readonly snapshots: Repository<SyncCaseSnapshotEntity>,
  ) {}

  async runPostPaymentSettlementSync(params: {
    tenantId: string;
    paymentId: string;
    approvalCorrelationId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    let latest = await this.syncTransitions.getLatestSyncToState(params.tenantId, params.paymentId);
    if (latest !== null && TERMINAL.has(latest)) {
      return;
    }

    if (latest === null) {
      requireSmekCompleted(
        await this.smekKernel.executeLoop({
          phase: ExecutionLoopPhase.SYNC,
          transition: {
            tenantId: params.tenantId,
            correlationId: params.paymentId,
            machine: MachineKind.SYNC,
            from: SyncMachineState.NOT_STARTED,
            to: SyncMachineState.IN_FLIGHT,
            actor: 'payment-service',
            metadata: { trigger: 'post_payment_success', idempotencyKey: params.idempotencyKey },
          },
          adapterEnvelope: null,
          complianceGate: {
            tenantId: params.tenantId,
            correlationId: params.paymentId,
            executionPhase: ExecutionLoopPhase.SYNC,
            borrowerOptedOut: params.borrowerOptedOut,
          },
          syncIngress: { source: 'POST_PAYMENT_SUCCESS' },
          idempotency: {
            key: params.idempotencyKey,
            step: IdempotencyStep.PaymentConfirmSyncBootstrap,
          },
        }),
        (m) => new SyncStateConflictError(m),
      );
    }

    latest = await this.syncTransitions.getLatestSyncToState(params.tenantId, params.paymentId);
    if (latest === SyncMachineState.COMPLETED) {
      return;
    }

    if (latest === SyncMachineState.CASE_FINALIZED) {
      await this.syncCompletedStep(params);
      return;
    }

    if (latest !== SyncMachineState.IN_FLIGHT) {
      throw new SyncStateConflictError(
        `Cannot run sync adapter: latest state is "${String(latest)}" (expected IN_FLIGHT).`,
      );
    }

    const finalizeResult = requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.SYNC,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.paymentId,
          machine: MachineKind.SYNC,
          from: SyncMachineState.IN_FLIGHT,
          to: SyncMachineState.CASE_FINALIZED,
          actor: 'sync-service',
          metadata: {
            approvalCorrelationId: params.approvalCorrelationId,
            syncStep: 'sync.case_finalized',
            idempotencyKey: params.idempotencyKey,
          },
        },
        adapterEnvelope: {
          kind: SyncCommandKind.PostPaymentSync,
          body: {
            tenantId: params.tenantId,
            paymentId: params.paymentId,
            approvalCorrelationId: params.approvalCorrelationId,
          },
        },
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.paymentId,
          executionPhase: ExecutionLoopPhase.SYNC,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        idempotency: {
          key: params.idempotencyKey,
          step: IdempotencyStep.SyncCaseFinalized,
        },
      }),
      (m) => new SyncStateConflictError(m),
    );

    await this.persistSettlementSnapshot(params, finalizeResult.adapterResult);
    await this.emitSyncCompletionAuditLog(params);

    await this.syncCompletedStep(params);
  }

  /** SMEK: CASE_FINALIZED → COMPLETED (`sync.completed`), idempotent. */
  private async syncCompletedStep(params: {
    tenantId: string;
    paymentId: string;
    approvalCorrelationId: string;
    idempotencyKey: string;
    borrowerOptedOut?: boolean;
  }): Promise<void> {
    const latest = await this.syncTransitions.getLatestSyncToState(params.tenantId, params.paymentId);
    if (latest === SyncMachineState.COMPLETED) {
      return;
    }
    if (latest !== SyncMachineState.CASE_FINALIZED) {
      throw new SyncStateConflictError(
        `Cannot complete sync loop: latest state is "${String(latest)}" (expected CASE_FINALIZED).`,
      );
    }

    requireSmekCompleted(
      await this.smekKernel.executeLoop({
        phase: ExecutionLoopPhase.SYNC,
        transition: {
          tenantId: params.tenantId,
          correlationId: params.paymentId,
          machine: MachineKind.SYNC,
          from: SyncMachineState.CASE_FINALIZED,
          to: SyncMachineState.COMPLETED,
          actor: 'sync-service',
          metadata: {
            approvalCorrelationId: params.approvalCorrelationId,
            syncStep: 'sync.completed',
            idempotencyKey: params.idempotencyKey,
          },
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId: params.tenantId,
          correlationId: params.paymentId,
          executionPhase: ExecutionLoopPhase.SYNC,
          borrowerOptedOut: params.borrowerOptedOut,
        },
        syncIngress: { source: 'SYNC_CASE_CLOSURE' },
        idempotency: {
          key: params.idempotencyKey,
          step: IdempotencyStep.SyncCompleted,
        },
      }),
      (m) => new SyncStateConflictError(m),
    );

    await this.snapshots.update(
      { tenantId: params.tenantId, paymentId: params.paymentId },
      { syncCompletedLogged: true },
    );
  }

  private async persistSettlementSnapshot(
    params: { tenantId: string; paymentId: string; approvalCorrelationId: string },
    adapterResult: unknown | undefined,
  ): Promise<void> {
    const snapshotJson = JSON.stringify({
      syncStep: 'sync.case_finalized',
      paymentId: params.paymentId,
      approvalCorrelationId: params.approvalCorrelationId,
      adapterResult: adapterResult ?? null,
      recordedAt: new Date().toISOString(),
    });

    const existing = await this.snapshots.findOne({
      where: { tenantId: params.tenantId, paymentId: params.paymentId },
    });
    if (existing) {
      existing.snapshotJson = snapshotJson;
      await this.snapshots.save(existing);
      return;
    }

    await this.snapshots.save(
      this.snapshots.create({
        tenantId: params.tenantId,
        paymentId: params.paymentId,
        snapshotJson,
        syncCompletedLogged: false,
      }),
    );
  }

  private emitSyncCompletionAuditLog(params: {
    tenantId: string;
    paymentId: string;
    approvalCorrelationId: string;
  }): void {
    this.logger.log(
      JSON.stringify({
        kind: 'sync.strict_loop.snapshot_persisted',
        tenantId: params.tenantId,
        paymentId: params.paymentId,
        approvalCorrelationId: params.approvalCorrelationId,
      }),
    );
  }
}
