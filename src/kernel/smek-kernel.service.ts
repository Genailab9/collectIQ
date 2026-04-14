import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DATA_EXECUTION_PORT,
  AI_EXECUTION_PORT,
  APPROVAL_ADAPTER,
  PAYMENT_EXECUTION_PORT,
  SYNC_ADAPTER,
  TELEPHONY_EXECUTION_PORT,
} from '../adapters/adapter.tokens';
import type { AiExecutionPort } from '../contracts/ai-execution.port';
import type { DataExecutionPort } from '../contracts/data-execution.port';
import type { PaymentExecutionPort } from '../contracts/payment-execution.port';
import type { ApprovalAdapter } from '../adapters/interfaces/approval-adapter.interface';
import type { ApprovalPolicyAdapterResult } from '../contracts/approval-policy.types';
import type { SyncAdapter } from '../adapters/interfaces/sync-adapter.interface';
import type { TelephonyExecutionPort } from '../contracts/telephony-execution.port';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ComplianceBlockedError, ComplianceGateInvalidError } from '../compliance/compliance.errors';
import { ResilienceService } from '../common/resilience/resilience.service';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { ComplianceService } from '../compliance/compliance.service';
import type { ComplianceGateInput } from '../compliance/compliance.types';
import { AiCommandKind } from '../contracts/ai-command-kind';
import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { PaymentCommandKind } from '../contracts/payment-command-kind';
import { TelephonyCommandKind } from '../contracts/telephony-command-kind';
import { StateMachineService } from '../state-machine/state-machine.service';
import { SmekOrchestrationAuditEntity } from './entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from './smek-orchestration-audit.kinds';
import {
  SmekAdapterEnvelopeForbiddenError,
  SmekAdapterEnvelopeRequiredError,
  SmekCommandStructuralError,
  SmekOrchestrationAuditError,
  SmekStateMachineNotReadyError,
} from './smek-kernel.errors';
import { ApprovalMachineState } from '../state-machine/definitions/approval-machine.definition';
import { CallMachineState } from '../state-machine/definitions/call-machine.definition';
import { DataMachineState } from '../state-machine/definitions/data-machine.definition';
import { SyncMachineState } from '../state-machine/definitions/sync-machine.definition';
import { MachineKind } from '../state-machine/types/machine-kind';
import type { TransitionProposal } from '../state-machine/types/transition-proposal';
import {
  SMEK_OUTCOME,
  type SmekLoopCommand,
  type SmekLoopComplianceBlockedResult,
  type SmekLoopResult,
} from './smek-kernel.dto';
import type { SmekKernelPort } from './smek-kernel.interface';
import { PrometheusMetricsService } from '../observability/prometheus-metrics.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { RateLimiterService } from '../rate-limit/rate-limiter.service';
import { assertSmekTransitionTenantMatchesOptionalAls } from '../tenant/tenant-isolation.policy';
import { ExecutionFeatureFlagsService } from '../modules/tenant-feature-flags/execution-feature-flags.service';

@Injectable()
export class SmekKernelService implements SmekKernelPort {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly tenantContext: TenantContextService,
    private readonly compliance: ComplianceService,
    private readonly atRestCipher: AtRestCipherService,
    private readonly stateMachine: StateMachineService,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly orchestrationAudit: Repository<SmekOrchestrationAuditEntity>,
    @Inject(TELEPHONY_EXECUTION_PORT)
    private readonly telephonyExecution: TelephonyExecutionPort,
    @Inject(AI_EXECUTION_PORT)
    private readonly aiExecution: AiExecutionPort,
    @Inject(DATA_EXECUTION_PORT)
    private readonly dataExecution: DataExecutionPort,
    @Inject(APPROVAL_ADAPTER) private readonly approval: ApprovalAdapter,
    @Inject(PAYMENT_EXECUTION_PORT)
    private readonly paymentExecution: PaymentExecutionPort,
    @Inject(SYNC_ADAPTER) private readonly sync: SyncAdapter,
    private readonly structured: StructuredLoggerService,
    private readonly metrics: PrometheusMetricsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly resilience: ResilienceService,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  /**
   * Single SMEK entry point (PRD v1.1 §2.1, §6.1, §11). Global compliance gate before transition log or adapters.
   * On block: returns `COMPLIANCE_BLOCKED` (no transition persisted, no adapter side-effects).
   */
  async executeLoop(command: SmekLoopCommand): Promise<SmekLoopResult> {
    this.assertStructuralIntegrity(command);

    if (!this.stateMachine.isEngineReady()) {
      throw new SmekStateMachineNotReadyError();
    }

    this.assertActiveTenantMatches(command);
    this.emitSmekStructured(command, 'SMEK', 'SMEK_LOOP_ENTER');

    let idemRowId: string | undefined;
    if (command.idempotency) {
      const idem = command.idempotency;
      const begin = await this.idempotency.checkKey(
        command.transition.tenantId,
        idem.key,
        idem.step,
        command.transition.correlationId,
      );
      if (begin.mode === 'replay') {
        this.emitSmekStructured(command, 'SMEK', 'SMEK_IDEMPOTENCY_REPLAY', {
          message: `outcome=${begin.result.outcome}`,
        });
        return begin.result;
      }
      idemRowId = begin.rowId;
    }

    await this.rateLimiter.acquireBeforeSmek(command);

    try {
      this.metrics.incExecutionsStarted(String(command.phase));
      const result = await this.executeLoopBody(command);
      if (idemRowId) {
        if (result.outcome === SMEK_OUTCOME.COMPLETED) {
          await this.idempotency.storeResult(command.transition.tenantId, idemRowId, result);
        } else {
          await this.idempotency.markFailed(command.transition.tenantId, idemRowId);
        }
      }
      if (result.outcome === SMEK_OUTCOME.COMPLETED) {
        this.metrics.incExecutionsCompleted(String(result.phase));
      } else {
        this.metrics.incExecutionsFailed('compliance');
      }
      this.emitSmekOutcomeStructured(command, result);
      return result;
    } catch (e) {
      this.metrics.incExecutionsFailed('exception');
      if (idemRowId) {
        await this.idempotency.markFailed(command.transition.tenantId, idemRowId);
      }
      this.emitSmekExceptionStructured(command, e);
      throw e;
    }
  }

  private async executeLoopBody(command: SmekLoopCommand): Promise<SmekLoopResult> {
    if (command.adapterEnvelope?.nonMutating === true) {
      const adapterResult = await this.invokeAdapter(command, command.transition);
      await this.persistKernelLoopOutputRecord(command, command.transition, adapterResult);
      await this.persistAdapterResult(command, command.transition, adapterResult);
      return {
        outcome: SMEK_OUTCOME.COMPLETED,
        phase: command.phase,
        tenantId: command.transition.tenantId,
        correlationId: command.transition.correlationId,
        adapterResult,
      };
    }

    let resolvedTransition = command.transition;
    let resolvedPolicy: ApprovalPolicyAdapterResult | undefined;

    const provisionalGate: ComplianceGateInput = {
      ...command.complianceGate,
      proposedMachine: command.transition.machine,
      proposedFrom: command.transition.from,
      proposedTo: command.transition.to,
    };
    const blockedProvisional = await this.runComplianceGate(provisionalGate);
    if (blockedProvisional) {
      return blockedProvisional;
    }

    if (command.approvalPolicyEvaluation) {
      const r = await this.resolveApprovalPolicyTransition(command);
      resolvedTransition = r.transition;
      resolvedPolicy = r.policy;
      if (resolvedTransition.to !== command.transition.to) {
        const resolvedGate: ComplianceGateInput = {
          ...command.complianceGate,
          proposedMachine: resolvedTransition.machine,
          proposedFrom: resolvedTransition.from,
          proposedTo: resolvedTransition.to,
        };
        const blockedResolved = await this.runComplianceGate(resolvedGate);
        if (blockedResolved) {
          return blockedResolved;
        }
      }
    }

    await this.stateMachine.recordValidatedTransition(resolvedTransition);

    const adapterResult = await this.invokeAdapter(command, resolvedTransition);

    await this.persistKernelLoopOutputRecord(command, resolvedTransition, adapterResult);
    await this.persistAdapterResult(command, resolvedTransition, adapterResult);

    return {
      outcome: SMEK_OUTCOME.COMPLETED,
      phase: command.phase,
      tenantId: resolvedTransition.tenantId,
      correlationId: resolvedTransition.correlationId,
      adapterResult,
      resolvedApprovalPolicy: resolvedPolicy ? { route: resolvedPolicy.route } : undefined,
    };
  }

  private async runComplianceGate(
    gate: ComplianceGateInput,
  ): Promise<SmekLoopComplianceBlockedResult | null> {
    try {
      await this.compliance.assertCompliant(gate);
      return null;
    } catch (e) {
      if (e instanceof ComplianceBlockedError) {
        return {
          outcome: SMEK_OUTCOME.COMPLIANCE_BLOCKED,
          phase: gate.executionPhase,
          tenantId: gate.tenantId.trim(),
          correlationId: gate.correlationId.trim(),
          blockCode: e.blockCode,
          message: e.message,
        };
      }
      if (e instanceof ComplianceGateInvalidError) {
        return {
          outcome: SMEK_OUTCOME.COMPLIANCE_BLOCKED,
          phase: gate.executionPhase,
          tenantId: gate.tenantId.trim(),
          correlationId: gate.correlationId.trim(),
          blockCode: 'compliance_gate_invalid',
          message: e.message,
        };
      }
      throw e;
    }
  }

  private async resolveApprovalPolicyTransition(command: SmekLoopCommand): Promise<{
    transition: TransitionProposal;
    policy: ApprovalPolicyAdapterResult;
  }> {
    const ev = command.approvalPolicyEvaluation!;
    const policy = await this.resilience.executeWithRetry({
      fn: () =>
        this.approval.evaluateApproval({
          tenantId: command.transition.tenantId,
          offerAmountCents: ev.offerAmountCents,
        }),
      retries: 3,
      backoff: 200,
      circuitKey: `approval.evaluateApproval:${command.transition.tenantId}`,
      unsafeAllowRetriesWithoutIdempotencyKey: true,
      operationLabel: 'approval.evaluateApproval',
      shouldRetry: (error) => this.isRetriableAdapterError(error),
      structuredLogContext: {
        tenantId: command.transition.tenantId.trim(),
        correlationId: command.transition.correlationId.trim(),
        phase: String(command.phase),
        state: `${command.transition.machine}:${command.transition.from}→${command.transition.to}`,
        adapter: 'approval.evaluateApproval',
      },
    });

    const metadata: Record<string, unknown> = {
      ...(command.transition.metadata ?? {}),
      policyRoute: policy.route,
      offerAmountCents: ev.offerAmountCents,
    };
    if (policy.escalationDeadlineAtIso) {
      metadata.escalationDeadlineAt = policy.escalationDeadlineAtIso;
    }

    return {
      transition: {
        ...command.transition,
        to: policy.toState,
        metadata,
      },
      policy,
    };
  }

  /** PRD v1.2 §5 / PRD §15 — when HTTP/cron tenant context is set, SMEK must use the same tenant. */
  private assertActiveTenantMatches(command: SmekLoopCommand): void {
    assertSmekTransitionTenantMatchesOptionalAls(
      this.tenantContext.getOptional(),
      command.transition.tenantId,
    );
  }

  private assertStructuralIntegrity(command: SmekLoopCommand): void {
    if (command.complianceGate.executionPhase !== command.phase) {
      throw new SmekCommandStructuralError('complianceGate.executionPhase must match command.phase');
    }
    if (command.complianceGate.tenantId !== command.transition.tenantId) {
      throw new SmekCommandStructuralError('complianceGate.tenantId must match transition.tenantId');
    }
    if (command.complianceGate.correlationId !== command.transition.correlationId) {
      throw new SmekCommandStructuralError(
        'complianceGate.correlationId must match transition.correlationId',
      );
    }
    this.assertPhaseMachineSemantics(command);
    const ingressCount = [
      !!command.telephonyIngress,
      !!command.approvalIngress,
      !!command.paymentIngress,
      !!command.syncIngress,
    ].filter(Boolean).length;
    if (ingressCount > 1) {
      throw new SmekCommandStructuralError('At most one ingress context may be set per command.');
    }
    if (command.syncIngress) {
      if (command.phase !== ExecutionLoopPhase.SYNC) {
        throw new SmekCommandStructuralError('syncIngress requires ExecutionLoopPhase.SYNC.');
      }
      if (command.transition.machine !== MachineKind.SYNC) {
        throw new SmekCommandStructuralError('syncIngress requires MachineKind.SYNC.');
      }
      if (command.syncIngress.source === 'POST_PAYMENT_SUCCESS') {
        if (
          command.transition.from !== SyncMachineState.NOT_STARTED ||
          command.transition.to !== SyncMachineState.IN_FLIGHT
        ) {
          throw new SmekCommandStructuralError(
            'syncIngress POST_PAYMENT_SUCCESS is only valid for NOT_STARTED→IN_FLIGHT.',
          );
        }
      } else if (command.syncIngress.source === 'SYNC_CASE_CLOSURE') {
        if (
          command.transition.from !== SyncMachineState.CASE_FINALIZED ||
          command.transition.to !== SyncMachineState.COMPLETED
        ) {
          throw new SmekCommandStructuralError(
            'syncIngress SYNC_CASE_CLOSURE is only valid for CASE_FINALIZED→COMPLETED (sync.completed).',
          );
        }
      } else {
        throw new SmekCommandStructuralError(`Unsupported syncIngress source "${command.syncIngress.source}".`);
      }
    }
    if (command.approvalPolicyEvaluation) {
      if (command.phase !== ExecutionLoopPhase.APPROVE) {
        throw new SmekCommandStructuralError(
          'approvalPolicyEvaluation is only valid for ExecutionLoopPhase.APPROVE.',
        );
      }
      if (!command.approvalIngress || command.approvalIngress.source !== 'INTERNAL_POLICY') {
        throw new SmekCommandStructuralError(
          'approvalPolicyEvaluation requires approvalIngress.source INTERNAL_POLICY.',
        );
      }
      if (command.transition.machine !== MachineKind.APPROVAL) {
        throw new SmekCommandStructuralError('approvalPolicyEvaluation requires APPROVAL machine.');
      }
      if (command.transition.from !== ApprovalMachineState.REQUESTED) {
        throw new SmekCommandStructuralError(
          'approvalPolicyEvaluation requires transition from REQUESTED.',
        );
      }
      if (command.transition.to !== ApprovalMachineState.PENDING) {
        throw new SmekCommandStructuralError(
          'approvalPolicyEvaluation requires provisional transition to PENDING (SMEK resolves APPROVED vs PENDING).',
        );
      }
    }
    this.assertAdapterEnvelopePolicy(command);
  }

  /**
   * PRD v1.1 §6.2 — execution phase is bound to exactly one state machine; specialized steps use canonical edges.
   */
  private assertPhaseMachineSemantics(command: SmekLoopCommand): void {
    const { phase, transition: t } = command;
    const expectedMachine: Record<ExecutionLoopPhase, MachineKind> = {
      [ExecutionLoopPhase.DATA]: MachineKind.DATA,
      [ExecutionLoopPhase.CALL]: MachineKind.CALL,
      [ExecutionLoopPhase.AUTHENTICATE]: MachineKind.CALL,
      [ExecutionLoopPhase.NEGOTIATE]: MachineKind.CALL,
      [ExecutionLoopPhase.APPROVE]: MachineKind.APPROVAL,
      [ExecutionLoopPhase.PAY]: MachineKind.PAYMENT,
      [ExecutionLoopPhase.SYNC]: MachineKind.SYNC,
    };
    const need = expectedMachine[phase];
    if (t.machine !== need) {
      throw new SmekCommandStructuralError(
        `Phase "${phase}" requires machine "${need}", got "${t.machine}".`,
      );
    }
    if (command.adapterEnvelope?.nonMutating === true) {
      return;
    }
    if (phase === ExecutionLoopPhase.DATA) {
      if (t.from !== DataMachineState.NOT_STARTED || t.to !== DataMachineState.COMPLETED) {
        throw new SmekCommandStructuralError(
          `DATA phase requires transition ${DataMachineState.NOT_STARTED}→${DataMachineState.COMPLETED}.`,
        );
      }
    }
    if (phase === ExecutionLoopPhase.NEGOTIATE) {
      if (t.from !== CallMachineState.AUTHENTICATED || t.to !== CallMachineState.NEGOTIATING) {
        throw new SmekCommandStructuralError(
          `NEGOTIATE phase requires transition ${CallMachineState.AUTHENTICATED}→${CallMachineState.NEGOTIATING}.`,
        );
      }
    }
    if (
      phase === ExecutionLoopPhase.CALL &&
      command.telephonyIngress?.source === 'INTERNAL_NEGOTIATION_COMPLETE'
    ) {
      if (t.from !== CallMachineState.NEGOTIATING || t.to !== CallMachineState.WAITING_APPROVAL) {
        throw new SmekCommandStructuralError(
          `CALL (INTERNAL_NEGOTIATION_COMPLETE) requires transition ${CallMachineState.NEGOTIATING}→${CallMachineState.WAITING_APPROVAL}.`,
        );
      }
    }
    if (
      phase === ExecutionLoopPhase.AUTHENTICATE &&
      command.telephonyIngress?.source === 'INTERNAL_AUTH_CHECKPOINT'
    ) {
      if (t.from !== CallMachineState.CONNECTED || t.to !== CallMachineState.AUTHENTICATED) {
        throw new SmekCommandStructuralError(
          `AUTHENTICATE (INTERNAL_AUTH_CHECKPOINT) requires transition ${CallMachineState.CONNECTED}→${CallMachineState.AUTHENTICATED}.`,
        );
      }
    }
  }

  private assertAdapterEnvelopePolicy(command: SmekLoopCommand): void {
    if (command.phase === ExecutionLoopPhase.DATA) {
      return;
    }
    if (command.adapterEnvelope?.nonMutating === true) {
      if (command.adapterEnvelope === null) {
        throw new SmekAdapterEnvelopeRequiredError(command.phase);
      }
      const ingressCount = [
        !!command.telephonyIngress,
        !!command.approvalIngress,
        !!command.paymentIngress,
        !!command.syncIngress,
      ].filter(Boolean).length;
      if (ingressCount > 0) {
        throw new SmekCommandStructuralError(
          'non-mutating adapter envelope cannot be combined with ingress context.',
        );
      }
      return;
    }
    const required = this.phaseRequiresAdapterEnvelope(command);
    if (required && command.adapterEnvelope === null) {
      throw new SmekAdapterEnvelopeRequiredError(command.phase);
    }
    if (!required && command.adapterEnvelope !== null) {
      throw new SmekAdapterEnvelopeForbiddenError(command.phase);
    }
  }

  private phaseRequiresAdapterEnvelope(command: SmekLoopCommand): boolean {
    if (command.phase === ExecutionLoopPhase.DATA) {
      return false;
    }
    if (this.isTelephonyIngressWithoutAdapter(command)) {
      return false;
    }
    if (this.isApprovalIngressWithoutAdapter(command)) {
      return false;
    }
    if (this.isPaymentIngressWithoutAdapter(command)) {
      return false;
    }
    if (this.isSyncIngressWithoutAdapter(command)) {
      return false;
    }
    return true;
  }

  private isTelephonyIngressWithoutAdapter(command: SmekLoopCommand): boolean {
    return (
      !!command.telephonyIngress &&
      (command.phase === ExecutionLoopPhase.CALL ||
        command.phase === ExecutionLoopPhase.AUTHENTICATE)
    );
  }

  private isApprovalIngressWithoutAdapter(command: SmekLoopCommand): boolean {
    return !!command.approvalIngress && command.phase === ExecutionLoopPhase.APPROVE;
  }

  private isPaymentIngressWithoutAdapter(command: SmekLoopCommand): boolean {
    return !!command.paymentIngress && command.phase === ExecutionLoopPhase.PAY;
  }

  private isSyncIngressWithoutAdapter(command: SmekLoopCommand): boolean {
    return !!command.syncIngress && command.phase === ExecutionLoopPhase.SYNC;
  }

  private async invokeAdapter(
    command: SmekLoopCommand,
    resolvedTransition: TransitionProposal,
  ): Promise<unknown | undefined> {
    const { phase, adapterEnvelope: envelope } = command;
    const wire = (adapter: string, result: string, message?: string): void => {
      this.structured.emit({
        ...this.smekStructuredBase(command),
        adapter,
        result,
        surface: 'SMEK_ADAPTER',
        ...(message ? { message } : {}),
      });
    };

    if (phase === ExecutionLoopPhase.DATA && envelope === null) {
      wire('n/a', 'ADAPTER_SKIPPED', 'DATA phase has no outbound adapter');
      return undefined;
    }
    if (this.isTelephonyIngressWithoutAdapter(command)) {
      wire('n/a', 'ADAPTER_SKIPPED', 'telephony ingress without outbound adapter');
      return undefined;
    }
    if (this.isApprovalIngressWithoutAdapter(command)) {
      wire('n/a', 'ADAPTER_SKIPPED', 'approval ingress without outbound adapter');
      return undefined;
    }
    if (this.isPaymentIngressWithoutAdapter(command)) {
      wire('n/a', 'ADAPTER_SKIPPED', 'payment ingress without outbound adapter');
      return undefined;
    }
    if (this.isSyncIngressWithoutAdapter(command)) {
      wire('n/a', 'ADAPTER_SKIPPED', 'sync ingress without outbound adapter');
      return undefined;
    }
    if (envelope === null) {
      throw new SmekAdapterEnvelopeRequiredError(phase);
    }

    // System-wide guarantee: outbound adapters only execute after an explicit compliance check.
    await this.compliance.assertCompliant({
      ...command.complianceGate,
      proposedMachine: resolvedTransition.machine,
      proposedFrom: resolvedTransition.from,
      proposedTo: resolvedTransition.to,
    });

    const tenantId = command.transition.tenantId.trim();
    const correlationId = command.transition.correlationId.trim();
    const simulated = await this.tryExecutionFlagAdapterShortcut(command, resolvedTransition, envelope);
    if (simulated !== null) {
      wire(envelope.kind, 'ADAPTER_SIMULATED');
      await this.persistAdapterLifecycleEvent(command, envelope.kind, 'START');
      await this.persistAdapterLifecycleEvent(command, envelope.kind, 'SUCCESS');
      return simulated;
    }

    wire(envelope.kind, 'ADAPTER_START');
    await this.persistAdapterLifecycleEvent(command, envelope.kind, 'START');
    try {
      const demoFast = await this.executionFlags.isJsonTruthy(tenantId, 'DEMO_MODE');
      const out = await this.resilience.executeWithRetry({
        fn: () => this.dispatchAdapterPhase(command, envelope),
        retries: demoFast ? 0 : 3,
        backoff: demoFast ? 0 : 200,
        circuitKey: `${envelope.kind}:${tenantId}`,
        idempotencyKey: command.idempotency?.key,
        unsafeAllowRetriesWithoutIdempotencyKey: envelope.nonMutating === true,
        operationLabel: envelope.kind,
        shouldRetry: (error) => this.isRetriableAdapterError(error),
        structuredLogContext: {
          tenantId,
          correlationId,
          phase: String(command.phase),
          state: `${command.transition.machine}:${command.transition.from}→${command.transition.to}`,
          adapter: envelope.kind,
        },
      });
      wire(envelope.kind, 'ADAPTER_SUCCESS');
      await this.persistAdapterLifecycleEvent(command, envelope.kind, 'SUCCESS');
      return out;
    } catch (e) {
      wire(envelope.kind, 'ADAPTER_ERROR', e instanceof Error ? e.message : String(e));
      await this.persistAdapterLifecycleEvent(command, envelope.kind, 'ERROR', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /**
   * Tenant feature-flag driven adapter shortcuts (demo / dry-run). Still audited via normal adapter lifecycle
   * when a shortcut is taken (START + SUCCESS; structured log uses ADAPTER_SIMULATED).
   */
  private async tryExecutionFlagAdapterShortcut(
    command: SmekLoopCommand,
    _resolvedTransition: TransitionProposal,
    envelope: NonNullable<SmekLoopCommand['adapterEnvelope']>,
  ): Promise<unknown | null> {
    const tenantId = command.transition.tenantId.trim();
    const phase = command.phase;

    const simCalls = await this.executionFlags.isJsonTruthy(tenantId, 'SIMULATE_CALLS');
    const forcePay = await this.executionFlags.isJsonTruthy(tenantId, 'FORCE_PAYMENT_SUCCESS');

    if (forcePay && phase === ExecutionLoopPhase.PAY) {
      if (envelope.kind === PaymentCommandKind.CreateIntent) {
        const body = envelope.body as { paymentId?: string };
        const paymentId =
          typeof body?.paymentId === 'string' && body.paymentId.trim().length > 0
            ? body.paymentId.trim()
            : command.transition.correlationId.trim();
        return {
          gatewayPaymentIntentId: `pi_collectiq_demo_${paymentId}`,
          status: 'requires_confirmation',
        };
      }
      if (envelope.kind === PaymentCommandKind.ConfirmPayment) {
        const body = envelope.body as { gatewayPaymentIntentId?: string };
        return {
          gatewayPaymentIntentId: body.gatewayPaymentIntentId ?? '',
          status: 'succeeded',
        };
      }
    }

    if (simCalls && phase === ExecutionLoopPhase.NEGOTIATE && envelope.kind === AiCommandKind.NegotiationSuggest) {
      return {
        intent: 'Borrower willing to discuss settlement (demo simulation).',
        offerSuggestion: 'Suggest structured payment over 3 months.',
        negotiationStrategy: 'Confirm hardship and restate policy boundaries.',
      };
    }

    if (
      simCalls &&
      (phase === ExecutionLoopPhase.CALL || phase === ExecutionLoopPhase.AUTHENTICATE) &&
      (envelope.kind === TelephonyCommandKind.InitiateCall ||
        envelope.kind === TelephonyCommandKind.GetStatus ||
        envelope.kind === TelephonyCommandKind.TerminateCall)
    ) {
      return { status: 'simulated', callSid: 'CA_COLLECTIQ_DEMO' };
    }

    return null;
  }

  private async dispatchAdapterPhase(
    command: SmekLoopCommand,
    envelope: NonNullable<SmekLoopCommand['adapterEnvelope']>,
  ): Promise<unknown> {
    const { phase } = command;
    switch (phase) {
      case ExecutionLoopPhase.DATA:
        return this.dataExecution.execute(envelope);
      case ExecutionLoopPhase.CALL:
      case ExecutionLoopPhase.AUTHENTICATE:
        return this.telephonyExecution.execute(envelope);
      case ExecutionLoopPhase.NEGOTIATE:
        return this.aiExecution.execute(envelope);
      case ExecutionLoopPhase.APPROVE:
        return this.approval.execute(envelope);
      case ExecutionLoopPhase.PAY:
        return this.paymentExecution.execute(envelope);
      case ExecutionLoopPhase.SYNC:
        return this.sync.execute(envelope);
      default:
        throw new SmekCommandStructuralError(`unsupported execution phase "${String(phase)}"`);
    }
  }

  private isRetriableAdapterError(error: unknown): boolean {
    const e = error as { code?: unknown; status?: unknown; statusCode?: unknown; retryable?: unknown };
    if (e?.retryable === false) {
      return false;
    }
    const code = typeof e?.code === 'string' ? e.code.toUpperCase() : '';
    if (code.includes('VALIDATION') || code.includes('INVALID') || code.includes('UNSUPPORTED')) {
      return false;
    }
    const status =
      typeof e?.status === 'number'
        ? e.status
        : typeof e?.statusCode === 'number'
          ? e.statusCode
          : null;
    if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return false;
    }
    return true;
  }

  /** PRD §12.1 — append-only output record (never treated as an execution trigger). */
  private async persistKernelLoopOutputRecord(
    command: SmekLoopCommand,
    resolvedTransition: TransitionProposal,
    adapterResult: unknown | undefined,
  ): Promise<void> {
    const payload = {
      name: `kernel.loop.${command.phase}.completed`,
      transition: {
        machine: resolvedTransition.machine,
        from: resolvedTransition.from,
        to: resolvedTransition.to,
      },
      adapterResult,
    };

    await this.insertAuditRow({
      kind: SMEK_ORCHESTRATION_AUDIT_KIND.LoopOutput,
      tenantId: resolvedTransition.tenantId,
      correlationId: resolvedTransition.correlationId,
      executionPhase: command.phase,
      payload,
    });
  }

  private async persistAdapterResult(
    command: SmekLoopCommand,
    resolvedTransition: TransitionProposal,
    adapterResult: unknown | undefined,
  ): Promise<void> {
    const payload = { adapterResult };
    await this.insertAuditRow({
      kind: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterResult,
      tenantId: resolvedTransition.tenantId,
      correlationId: resolvedTransition.correlationId,
      executionPhase: command.phase,
      payload,
    });
  }

  private async persistAdapterLifecycleEvent(
    command: SmekLoopCommand,
    adapterKind: string,
    stage: 'START' | 'SUCCESS' | 'ERROR',
    extras?: { error?: string },
  ): Promise<void> {
    const kind =
      stage === 'START'
        ? SMEK_ORCHESTRATION_AUDIT_KIND.AdapterStart
        : stage === 'SUCCESS'
          ? SMEK_ORCHESTRATION_AUDIT_KIND.AdapterSuccess
          : SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError;
    await this.insertAuditRow({
      kind,
      tenantId: command.transition.tenantId,
      correlationId: command.transition.correlationId,
      executionPhase: command.phase,
      payload: {
        adapter: adapterKind,
        stage,
        ...(extras?.error ? { error: extras.error } : {}),
      },
    });
  }

  private async insertAuditRow(input: {
    kind: SmekOrchestrationAuditEntity['kind'];
    tenantId: string;
    correlationId: string;
    executionPhase: ExecutionLoopPhase;
    payload: unknown;
  }): Promise<void> {
    let payloadJson: string;
    try {
      payloadJson = this.atRestCipher.sealPayloadJson(JSON.stringify(input.payload));
    } catch (cause) {
      throw new SmekOrchestrationAuditError(cause);
    }

    const row = this.orchestrationAudit.create({
      kind: input.kind,
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      executionPhase: input.executionPhase,
      payloadJson,
    });

    try {
      await this.orchestrationAudit.save(row);
    } catch (cause) {
      throw new SmekOrchestrationAuditError(cause);
    }
  }

  private smekStructuredBase(command: SmekLoopCommand): {
    correlationId: string;
    tenantId: string;
    phase: string;
    state: string;
    adapter: string;
  } {
    const t = command.transition;
    return {
      correlationId: t.correlationId.trim(),
      tenantId: t.tenantId.trim(),
      phase: String(command.phase),
      state: `${t.machine}:${t.from}→${t.to}`,
      adapter: command.adapterEnvelope?.kind ?? this.inferIngressAdapterLabel(command),
    };
  }

  private inferIngressAdapterLabel(command: SmekLoopCommand): string {
    if (command.telephonyIngress) {
      return `ingress:telephony:${command.telephonyIngress.source}`;
    }
    if (command.approvalIngress) {
      return `ingress:approval:${command.approvalIngress.source}`;
    }
    if (command.paymentIngress) {
      return `ingress:payment:${command.paymentIngress.source}`;
    }
    if (command.syncIngress) {
      return `ingress:sync:${command.syncIngress.source}`;
    }
    return 'n/a';
  }

  private emitSmekStructured(
    command: SmekLoopCommand,
    surface: string,
    result: string,
    extras?: { message?: string },
  ): void {
    this.structured.emit({
      ...this.smekStructuredBase(command),
      result,
      surface,
      ...(extras?.message ? { message: extras.message } : {}),
    });
  }

  private emitSmekOutcomeStructured(command: SmekLoopCommand, result: SmekLoopResult): void {
    const base = this.smekStructuredBase(command);
    if (result.outcome === SMEK_OUTCOME.COMPLETED) {
      this.structured.emit({ ...base, result: 'SMEK_COMPLETED', surface: 'SMEK' });
      return;
    }
    this.structured.emit({
      ...base,
      phase: String(result.phase),
      result: 'COMPLIANCE_BLOCKED',
      surface: 'SMEK',
      message: `${result.blockCode}: ${result.message}`,
    });
  }

  private emitSmekExceptionStructured(command: SmekLoopCommand, err: unknown): void {
    this.structured.emit({
      ...this.smekStructuredBase(command),
      result: 'SMEK_UNHANDLED_EXCEPTION',
      surface: 'SMEK',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
