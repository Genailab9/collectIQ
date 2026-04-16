import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyStep } from '../contracts/idempotency-step';
import { SyncCommandKind } from '../contracts/sync-command-kind';
import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { SmekKernelService } from '../kernel/smek-kernel.service';
import type { SmekLoopCommand } from '../kernel/smek-kernel.dto';
import { SMEK_OUTCOME, type SmekLoopResult } from '../kernel/smek-kernel.dto';
import { PaymentTransitionQueryService } from '../modules/payment/payment-transition.query';
import { DataMachineState } from '../state-machine/definitions/data-machine.definition';
import { PaymentMachineState } from '../state-machine/definitions/payment-machine.definition';
import { SyncMachineState } from '../state-machine/definitions/sync-machine.definition';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { MachineRegistryService } from '../state-machine/machine-registry.service';
import { MachineKind } from '../state-machine/types/machine-kind';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { emitRuntimeProof } from '../runtime-proof/runtime-proof-emitter';

const MACHINE_SCAN_ORDER: readonly MachineKind[] = [
  MachineKind.DATA,
  MachineKind.CALL,
  MachineKind.APPROVAL,
  MachineKind.PAYMENT,
  MachineKind.SYNC,
] as const;

export interface TransitionLogView {
  readonly id: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly machine: MachineKind;
  readonly fromState: string;
  readonly toState: string;
  readonly occurredAt: Date;
  readonly metadataJson: string | null;
}

export type MachineStateMap = Partial<Record<MachineKind, string>>;

export type PendingExecution =
  | { readonly kind: 'none' }
  | { readonly kind: 'blocked'; readonly reason: string }
  | {
      readonly kind: 'ready';
      readonly machine: MachineKind;
      readonly from: string;
      readonly to: string;
      readonly phase: ExecutionLoopPhase;
      readonly idempotency: { readonly key: string; readonly step: string };
    };

export interface ExecutionRecoveryOptions {
  /**
   * When true and the log has no DATA rows, treat DATA as `NOT_STARTED` so the next hop can be derived.
   * Default false so payment-scoped correlation ids are not misclassified as unsettled DATA work.
   */
  readonly inferDataNotStarted?: boolean;
  /**
   * When true (default), if the log has no SYNC rows and PAYMENT is terminal SUCCESS, treat SYNC as `NOT_STARTED`.
   */
  readonly inferSyncAfterPaymentSuccess?: boolean;
}

export interface ExecutionSnapshot {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly transitionsAsc: readonly TransitionLogView[];
  readonly states: MachineStateMap;
  readonly lastTransition: TransitionLogView | null;
  /** Latest non-failure row in time order (append-only success path). */
  readonly lastSuccessfulTransition: TransitionLogView | null;
  readonly pending: PendingExecution;
}

export interface RecoverExecutionResult {
  readonly snapshot: ExecutionSnapshot;
  readonly action: 'executed' | 'noop' | 'blocked';
  readonly smekResult?: SmekLoopResult;
  readonly blockReason?: string;
}

/**
 * PRD v1.3 — reconstruct execution from `state_transition_log` only; resume strictly via SMEK (no direct writes).
 */
@Injectable()
export class ExecutionRecoveryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    private readonly machines: MachineRegistryService,
    private readonly smekKernel: SmekKernelService,
    private readonly paymentTransitions: PaymentTransitionQueryService,
    private readonly structured: StructuredLoggerService,
  ) {}

  async getExecutionSnapshot(
    tenantId: string,
    correlationId: string,
    options?: ExecutionRecoveryOptions,
  ): Promise<ExecutionSnapshot> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const inferData = options?.inferDataNotStarted === true;
    const inferSync = options?.inferSyncAfterPaymentSuccess !== false;
    const rows = await this.loadOrderedTransitions(t, c);
    const views = rows.map(toView);
    const states = await this.deriveStates(t, c, views, inferData, inferSync);
    const last = views.length > 0 ? views[views.length - 1]! : null;
    const lastSuccessful = pickLastNonFailure(views);
    const pending = this.computePending(t, c, states, views);
    return {
      tenantId: t,
      correlationId: c,
      transitionsAsc: views,
      states,
      lastTransition: last,
      lastSuccessfulTransition: lastSuccessful,
      pending,
    };
  }

  async recoverExecution(
    tenantId: string,
    correlationId: string,
    options?: ExecutionRecoveryOptions & { readonly borrowerOptedOut?: boolean },
  ): Promise<RecoverExecutionResult> {
    const { borrowerOptedOut, ...snapOpts } = options ?? {};
    const t = tenantId.trim();
    const c = correlationId.trim();
    const snapshot = await this.getExecutionSnapshot(t, c, snapOpts);

    const recoveryState =
      snapshot.pending.kind === 'ready'
        ? `${snapshot.pending.machine}:${snapshot.pending.from}→${snapshot.pending.to}`
        : snapshot.pending.kind;

    this.structured.emit({
      correlationId: c,
      tenantId: t,
      phase: 'EXECUTION_RECOVERY',
      state: recoveryState,
      adapter: 'n/a',
      result: 'RECOVERY_SNAPSHOT',
      surface: 'RECOVERY',
    });

    if (snapshot.pending.kind === 'none') {
      this.structured.emit({
        correlationId: c,
        tenantId: t,
        phase: 'EXECUTION_RECOVERY',
        state: recoveryState,
        adapter: 'n/a',
        result: 'RECOVERY_NOOP',
        surface: 'RECOVERY',
      });
      return { snapshot, action: 'noop' };
    }
    if (snapshot.pending.kind === 'blocked') {
      this.structured.emit({
        correlationId: c,
        tenantId: t,
        phase: 'EXECUTION_RECOVERY',
        state: recoveryState,
        adapter: 'n/a',
        result: 'RECOVERY_BLOCKED',
        surface: 'RECOVERY',
        message: snapshot.pending.reason,
      });
      return { snapshot, action: 'blocked', blockReason: snapshot.pending.reason };
    }

    const cmd = this.buildRecoveryCommand(snapshot.pending, snapshot, borrowerOptedOut === true);
    if (!cmd) {
      this.structured.emit({
        correlationId: c,
        tenantId: t,
        phase: 'EXECUTION_RECOVERY',
        state: recoveryState,
        adapter: 'n/a',
        result: 'RECOVERY_BUILD_COMMAND_FAILED',
        surface: 'RECOVERY',
      });
      return {
        snapshot,
        action: 'blocked',
        blockReason: 'Recovery could not build a SMEK command for the pending edge.',
      };
    }

    this.structured.emit({
      correlationId: c,
      tenantId: t,
      phase: 'EXECUTION_RECOVERY',
      state: recoveryState,
      adapter: 'n/a',
      result: 'RECOVERY_SMEK_DISPATCH',
      surface: 'RECOVERY',
    });
    emitRuntimeProof({
      requirement_id: 'REQ-REC-003',
      event_type: 'WORKER_EXECUTION',
      tenant_id: t,
      metadata: {
        correlationId: c,
        machine: snapshot.pending.machine,
        from: snapshot.pending.from,
        to: snapshot.pending.to,
        action: 'dispatch',
      },
    });

    const smekResult = await this.smekKernel.executeLoop(cmd);
    const action = smekResult.outcome === SMEK_OUTCOME.COMPLETED ? 'executed' : 'blocked';
    this.structured.emit({
      correlationId: c,
      tenantId: t,
      phase: 'EXECUTION_RECOVERY',
      state: recoveryState,
      adapter: 'n/a',
      result: action === 'executed' ? 'RECOVERY_EXECUTED' : 'RECOVERY_SMKE_BLOCKED',
      surface: 'RECOVERY',
      message:
        smekResult.outcome === SMEK_OUTCOME.COMPLIANCE_BLOCKED ? smekResult.message : undefined,
    });
    return {
      snapshot,
      action,
      smekResult,
      blockReason:
        smekResult.outcome === SMEK_OUTCOME.COMPLIANCE_BLOCKED ? smekResult.message : undefined,
    };
  }

  private async loadOrderedTransitions(
    tenantId: string,
    correlationId: string,
  ): Promise<StateTransitionLogEntity[]> {
    return this.transitions
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.correlationId = :correlationId', { correlationId })
      .orderBy('t.occurredAt', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();
  }

  private async deriveStates(
    tenantId: string,
    correlationId: string,
    views: readonly TransitionLogView[],
    inferData: boolean,
    inferSync: boolean,
  ): Promise<MachineStateMap> {
    const latest = new Map<MachineKind, string>();
    for (const v of views) {
      latest.set(v.machine, v.toState);
    }
    const out: MachineStateMap = {};
    for (const [k, v] of latest) {
      out[k] = v;
    }

    if (inferData && !latest.has(MachineKind.DATA)) {
      out[MachineKind.DATA] = DataMachineState.NOT_STARTED;
    }

    if (inferSync && !latest.has(MachineKind.SYNC)) {
      const payState = await this.paymentTransitions.getLatestPaymentToState(tenantId, correlationId);
      if (payState === PaymentMachineState.SUCCESS) {
        out[MachineKind.SYNC] = SyncMachineState.NOT_STARTED;
      }
    }

    return out;
  }

  private computePending(
    tenantId: string,
    correlationId: string,
    states: MachineStateMap,
    views: readonly TransitionLogView[],
  ): PendingExecution {
    for (const machine of MACHINE_SCAN_ORDER) {
      const current = states[machine];
      if (!current) {
        continue;
      }
      const def = this.machines.getDefinition(machine);
      if (def.terminalStates.has(current)) {
        continue;
      }
      if (machine === MachineKind.PAYMENT && current === PaymentMachineState.SUCCESS) {
        continue;
      }
      const allowed = def.transitions.get(current);
      if (!allowed || allowed.size === 0) {
        return { kind: 'blocked', reason: `No outgoing transitions from "${current}" on ${machine}.` };
      }
      const to = pickDeterministicTarget(machine, current, allowed);
      if (!to) {
        return {
          kind: 'blocked',
          reason: `Recovery target is ambiguous for ${machine} from "${current}".`,
        };
      }
      const phase = phaseForMachine(machine);
      const idem = this.buildIdempotencyForEdge(machine, current, to, tenantId, correlationId, views);
      if (!idem) {
        return {
          kind: 'blocked',
          reason: `Recovery for ${machine} edge ${current}→${to} requires adapter or ingress context not available from the log.`,
        };
      }
      return { kind: 'ready', machine, from: current, to, phase, idempotency: idem };
    }
    return { kind: 'none' };
  }

  private buildIdempotencyForEdge(
    machine: MachineKind,
    from: string,
    to: string,
    tenantId: string,
    correlationId: string,
    views: readonly TransitionLogView[],
  ): { key: string; step: string } | null {
    const recoveryKey = deterministicRecoveryKey(tenantId, correlationId, machine, from, to);

    if (machine === MachineKind.DATA && from === DataMachineState.NOT_STARTED && to === DataMachineState.COMPLETED) {
      const fromLog = extractDataIdempotencyFromLog(views);
      if (fromLog) {
        return fromLog;
      }
      return { key: recoveryKey, step: IdempotencyStep.RecoveryDataComplete };
    }

    if (machine === MachineKind.SYNC) {
      const syncKey = extractSyncClientIdempotencyKey(views);
      if (!syncKey) {
        return null;
      }
      if (from === SyncMachineState.NOT_STARTED && to === SyncMachineState.IN_FLIGHT) {
        return { key: syncKey, step: IdempotencyStep.PaymentConfirmSyncBootstrap };
      }
      if (from === SyncMachineState.IN_FLIGHT && to === SyncMachineState.CASE_FINALIZED) {
        return { key: syncKey, step: IdempotencyStep.SyncCaseFinalized };
      }
      if (from === SyncMachineState.CASE_FINALIZED && to === SyncMachineState.COMPLETED) {
        return { key: syncKey, step: IdempotencyStep.SyncCompleted };
      }
    }

    if (
      machine === MachineKind.PAYMENT &&
      from === PaymentMachineState.PROCESSING &&
      to === PaymentMachineState.SUCCESS
    ) {
      return { key: recoveryKey, step: IdempotencyStep.WebhookStripePaymentStatus };
    }
    if (machine === MachineKind.CALL) {
      return { key: recoveryKey, step: IdempotencyStep.WebhookTwilioVoiceStatus };
    }
    if (machine === MachineKind.APPROVAL) {
      return { key: recoveryKey, step: IdempotencyStep.ApprovalOfficerDecision };
    }

    return null;
  }

  private buildRecoveryCommand(
    pending: Extract<PendingExecution, { kind: 'ready' }>,
    snapshot: ExecutionSnapshot,
    borrowerOptedOut: boolean,
  ): SmekLoopCommand | null {
    const { tenantId, correlationId } = snapshot;
    const { machine, from, to, idempotency } = pending;

    if (machine === MachineKind.DATA) {
      return {
        phase: ExecutionLoopPhase.DATA,
        transition: {
          tenantId,
          correlationId,
          machine: MachineKind.DATA,
          from,
          to,
          actor: 'execution-recovery',
          metadata: { recovery: true, recoverySource: 'execution-recovery.service' },
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId,
          correlationId,
          executionPhase: ExecutionLoopPhase.DATA,
          borrowerOptedOut,
        },
        idempotency: { key: idempotency.key, step: idempotency.step },
      };
    }

    if (machine === MachineKind.SYNC) {
      const approvalCorrelationId = extractSyncApprovalCorrelation(snapshot.transitionsAsc);
      if (!approvalCorrelationId) {
        return null;
      }
      if (from === SyncMachineState.NOT_STARTED && to === SyncMachineState.IN_FLIGHT) {
        return {
          phase: ExecutionLoopPhase.SYNC,
          transition: {
            tenantId,
            correlationId,
            machine: MachineKind.SYNC,
            from,
            to,
            actor: 'execution-recovery',
            metadata: {
              trigger: 'post_payment_success',
              idempotencyKey: idempotency.key,
              recovery: true,
            },
          },
          adapterEnvelope: null,
          complianceGate: {
            tenantId,
            correlationId,
            executionPhase: ExecutionLoopPhase.SYNC,
            borrowerOptedOut,
          },
          syncIngress: { source: 'POST_PAYMENT_SUCCESS' },
          idempotency: { key: idempotency.key, step: idempotency.step },
        };
      }
      if (from === SyncMachineState.IN_FLIGHT && to === SyncMachineState.CASE_FINALIZED) {
        return {
          phase: ExecutionLoopPhase.SYNC,
          transition: {
            tenantId,
            correlationId,
            machine: MachineKind.SYNC,
            from,
            to,
            actor: 'execution-recovery',
            metadata: {
              approvalCorrelationId,
              syncStep: 'sync.case_finalized',
              idempotencyKey: idempotency.key,
              recovery: true,
            },
          },
          adapterEnvelope: {
            kind: SyncCommandKind.PostPaymentSync,
            body: { tenantId, paymentId: correlationId, approvalCorrelationId },
          },
          complianceGate: {
            tenantId,
            correlationId,
            executionPhase: ExecutionLoopPhase.SYNC,
            borrowerOptedOut,
          },
          idempotency: { key: idempotency.key, step: idempotency.step },
        };
      }
      if (from === SyncMachineState.CASE_FINALIZED && to === SyncMachineState.COMPLETED) {
        return {
          phase: ExecutionLoopPhase.SYNC,
          transition: {
            tenantId,
            correlationId,
            machine: MachineKind.SYNC,
            from,
            to,
            actor: 'execution-recovery',
            metadata: {
              approvalCorrelationId,
              syncStep: 'sync.completed',
              idempotencyKey: idempotency.key,
              recovery: true,
            },
          },
          adapterEnvelope: null,
          complianceGate: {
            tenantId,
            correlationId,
            executionPhase: ExecutionLoopPhase.SYNC,
            borrowerOptedOut,
          },
          syncIngress: { source: 'SYNC_CASE_CLOSURE' },
          idempotency: { key: idempotency.key, step: idempotency.step },
        };
      }
    }

    if (machine === MachineKind.PAYMENT) {
      if (from === PaymentMachineState.PROCESSING && to === PaymentMachineState.SUCCESS) {
        return {
          phase: ExecutionLoopPhase.PAY,
          transition: {
            tenantId,
            correlationId,
            machine: MachineKind.PAYMENT,
            from,
            to,
            actor: 'execution-recovery',
            metadata: {
              recovery: true,
              recoverySource: 'execution-recovery.service',
              recoveryKind: 'payment-success-reconcile',
            },
          },
          adapterEnvelope: null,
          complianceGate: {
            tenantId,
            correlationId,
            executionPhase: ExecutionLoopPhase.PAY,
            borrowerOptedOut,
          },
          paymentIngress: { source: 'GATEWAY_WEBHOOK' },
          idempotency: { key: idempotency.key, step: idempotency.step },
        };
      }
    }
    if (machine === MachineKind.CALL) {
      return {
        phase: ExecutionLoopPhase.CALL,
        transition: {
          tenantId,
          correlationId,
          machine: MachineKind.CALL,
          from,
          to,
          actor: 'execution-recovery',
          metadata: {
            recovery: true,
            recoverySource: 'execution-recovery.service',
            recoveryKind: 'call-status-reconcile',
          },
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId,
          correlationId,
          executionPhase: ExecutionLoopPhase.CALL,
          borrowerOptedOut,
        },
        telephonyIngress: { source: 'TWILIO_VOICE_STATUS' },
        idempotency: { key: idempotency.key, step: idempotency.step },
      };
    }
    if (machine === MachineKind.APPROVAL) {
      return {
        phase: ExecutionLoopPhase.APPROVE,
        transition: {
          tenantId,
          correlationId,
          machine: MachineKind.APPROVAL,
          from,
          to,
          actor: 'execution-recovery',
          metadata: {
            recovery: true,
            recoverySource: 'execution-recovery.service',
            recoveryKind: 'approval-reconcile',
          },
        },
        adapterEnvelope: null,
        complianceGate: {
          tenantId,
          correlationId,
          executionPhase: ExecutionLoopPhase.APPROVE,
          borrowerOptedOut,
        },
        approvalIngress: { source: 'OFFICER_API' },
        idempotency: { key: idempotency.key, step: idempotency.step },
      };
    }

    return null;
  }
}

function toView(row: StateTransitionLogEntity): TransitionLogView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    correlationId: row.correlationId,
    machine: row.machine as MachineKind,
    fromState: row.fromState,
    toState: row.toState,
    occurredAt: row.occurredAt,
    metadataJson: row.metadataJson,
  };
}

function pickDeterministicTarget(
  machine: MachineKind,
  from: string,
  allowed: ReadonlySet<string>,
): string | null {
  if (machine === MachineKind.PAYMENT && from === PaymentMachineState.PROCESSING) {
    if (allowed.has(PaymentMachineState.SUCCESS)) {
      return PaymentMachineState.SUCCESS;
    }
    return null;
  }
  if (machine === MachineKind.SYNC) {
    if (from === SyncMachineState.NOT_STARTED && allowed.has(SyncMachineState.IN_FLIGHT)) {
      return SyncMachineState.IN_FLIGHT;
    }
    if (from === SyncMachineState.IN_FLIGHT && allowed.has(SyncMachineState.CASE_FINALIZED)) {
      return SyncMachineState.CASE_FINALIZED;
    }
    if (from === SyncMachineState.CASE_FINALIZED && allowed.has(SyncMachineState.COMPLETED)) {
      return SyncMachineState.COMPLETED;
    }
    return null;
  }
  if (machine === MachineKind.CALL) {
    const callPreferred: Record<string, string> = {
      INITIATED: 'RINGING',
      RINGING: 'CONNECTED',
      CONNECTED: 'AUTHENTICATED',
      AUTHENTICATED: 'NEGOTIATING',
      NEGOTIATING: 'WAITING_APPROVAL',
      WAITING_APPROVAL: 'PAYMENT_PENDING',
      PAYMENT_PENDING: 'COMPLETED',
      RETRY_SCHEDULED: 'INITIATED',
    };
    const target = callPreferred[from];
    if (target && allowed.has(target)) {
      return target;
    }
    return null;
  }
  if (machine === MachineKind.APPROVAL) {
    const approvalPreferred: Record<string, string> = {
      REQUESTED: 'PENDING',
      PENDING: 'ESCALATED',
      COUNTER: 'PENDING',
      TIMEOUT: 'PENDING',
      ESCALATED: 'PENDING',
    };
    const target = approvalPreferred[from];
    if (target && allowed.has(target)) {
      return target;
    }
    return null;
  }
  if (machine === MachineKind.DATA) {
    if (from === DataMachineState.NOT_STARTED && allowed.has(DataMachineState.COMPLETED)) {
      return DataMachineState.COMPLETED;
    }
    return null;
  }
  return null;
}

function phaseForMachine(machine: MachineKind): ExecutionLoopPhase {
  switch (machine) {
    case MachineKind.DATA:
      return ExecutionLoopPhase.DATA;
    case MachineKind.CALL:
      return ExecutionLoopPhase.CALL;
    case MachineKind.APPROVAL:
      return ExecutionLoopPhase.APPROVE;
    case MachineKind.PAYMENT:
      return ExecutionLoopPhase.PAY;
    case MachineKind.SYNC:
      return ExecutionLoopPhase.SYNC;
    default:
      return ExecutionLoopPhase.DATA;
  }
}

function deterministicRecoveryKey(
  tenantId: string,
  correlationId: string,
  machine: MachineKind,
  from: string,
  to: string,
): string {
  return `recovery:v1:${tenantId}:${correlationId}:${machine}:${from}->${to}`;
}

function extractSyncClientIdempotencyKey(views: readonly TransitionLogView[]): string | null {
  const syncRows = views.filter((v) => v.machine === MachineKind.SYNC);
  for (let i = syncRows.length - 1; i >= 0; i -= 1) {
    const meta = parseJson(syncRows[i]!.metadataJson);
    const k = meta && typeof meta.idempotencyKey === 'string' ? meta.idempotencyKey.trim() : '';
    if (k) {
      return k;
    }
  }
  return null;
}

function extractSyncApprovalCorrelation(views: readonly TransitionLogView[]): string | null {
  const syncRows = views.filter((v) => v.machine === MachineKind.SYNC);
  for (let i = syncRows.length - 1; i >= 0; i -= 1) {
    const meta = parseJson(syncRows[i]!.metadataJson);
    const a =
      meta && typeof meta.approvalCorrelationId === 'string' ? meta.approvalCorrelationId.trim() : '';
    if (a) {
      return a;
    }
  }
  return null;
}

function extractDataIdempotencyFromLog(
  views: readonly TransitionLogView[],
): { key: string; step: string } | null {
  const dataRows = views.filter((v) => v.machine === MachineKind.DATA);
  for (let i = dataRows.length - 1; i >= 0; i -= 1) {
    const meta = parseJson(dataRows[i]!.metadataJson);
    const k = meta && typeof meta.idempotencyKey === 'string' ? meta.idempotencyKey.trim() : '';
    const s = meta && typeof meta.idempotencyStep === 'string' ? meta.idempotencyStep.trim() : '';
    if (k && s) {
      return { key: k, step: s };
    }
  }
  return null;
}

function pickLastNonFailure(views: readonly TransitionLogView[]): TransitionLogView | null {
  for (let i = views.length - 1; i >= 0; i -= 1) {
    const v = views[i]!;
    if (v.toState !== 'FAILED') {
      return v;
    }
  }
  return null;
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
