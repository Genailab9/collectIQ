import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { IdempotencyStep } from '../../../contracts/idempotency-step';
import { isSmekComplianceBlocked } from '../../../kernel/smek-kernel.dto';
import type { SmekLoopComplianceBlockedResult } from '../../../kernel/smek-kernel.dto';
import { SmekKernelService } from '../../../kernel/smek-kernel.service';
import { CallMachineState } from '../../../state-machine/definitions/call-machine.definition';
import { MachineRegistryService } from '../../../state-machine/machine-registry.service';
import { MachineKind } from '../../../state-machine/types/machine-kind';
import { CallTransitionQueryService } from '../call-transition-query.service';
import { TwilioVoiceStatusToSmekMapper } from '../twilio/twilio-voice-status-to-smek.mapper';
import { TenantContextService } from '../../../tenant/tenant-context.service';
import { TenantCorrelationResolverService } from '../../../tenant/tenant-correlation-resolver.service';
import { WebhookEventService } from './webhook-event.service';
import { TenantEventStreamService } from '../../../events/stream/tenant-event-stream.service';

const TWILIO_PROVIDER = 'twilio';

/** SMEK idempotency key is scoped to persisted `webhook_events.id` (PRD §6). */
export function webhookEventIdempotencyKey(webhookEventId: string): string {
  return `webhook_event:${webhookEventId}`;
}

export type CallVoiceRecoveryOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'noop' }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'compliance_blocked'; readonly result: SmekLoopComplianceBlockedResult };

/**
 * PRD §6 — Twilio voice status: signature (guard) → persist event → **state only from `state_transition_log`**
 * → validate CALL machine edge → SMEK (idempotent per `webhook_events.id`). No client query state.
 */
@Injectable()
export class TwilioWebhookService {
  private readonly logger = new Logger(TwilioWebhookService.name);

  constructor(
    private readonly webhookEvents: WebhookEventService,
    private readonly callTransitions: CallTransitionQueryService,
    private readonly machines: MachineRegistryService,
    private readonly smekKernel: SmekKernelService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantCorrelationResolver: TenantCorrelationResolverService,
    @Optional() private readonly eventStream?: TenantEventStreamService,
  ) {}

  /**
   * PRD §6.3 — provider poll recovery (no `webhook_events` row). Idempotent per `(tenant, correlation, observed status)`.
   */
  async executeRecoveryVoiceStatus(params: {
    readonly tenantId: string;
    readonly correlationId: string;
    /** Twilio REST / voice status string (e.g. `in-progress`, `completed`). */
    readonly providerCallStatus: string;
    readonly idempotencyKey: string;
  }): Promise<CallVoiceRecoveryOutcome> {
    const callStatus = params.providerCallStatus.trim();
    if (!callStatus) {
      return { kind: 'noop' };
    }
    return this.applyCallStatusThroughSmek({
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      callStatus,
      idempotency: {
        key: params.idempotencyKey,
        step: IdempotencyStep.WebhookRecoveryPoll,
      },
      complianceThrows: false,
    });
  }

  /**
   * Ingest Twilio `CallStatus` after signature verification.
   * Duplicate deliveries (same provider dedupe key) return without re-entering SMEK (HTTP 200 no-op at controller).
   */
  async handleVoiceStatus(params: {
    readonly body: Record<string, string>;
    readonly correlationId: string;
  }): Promise<void> {
    const resolved = await this.tenantCorrelationResolver.resolveTenantIdForCorrelation(
      params.correlationId,
      { twilioAccountSid: params.body.AccountSid },
    );
    if (!resolved) {
      throw new ForbiddenException(
        'Unknown call correlation or ambiguous tenant; cannot resolve tenant before SMEK.',
      );
    }

    return this.tenantContext.run(resolved, async () => {
      await this.executeUnderTenant(params, resolved);
    });
  }

  private async executeUnderTenant(
    params: { readonly body: Record<string, string>; readonly correlationId: string },
    tenantId: string,
  ): Promise<void> {
    const callStatus = params.body.CallStatus?.trim();
    if (!callStatus) {
      return;
    }

    const callSid = params.body.CallSid?.trim() ?? '';
    const externalDedupeKey = `twilio:voice_status:${callSid || 'unknown'}:${callStatus}:${tenantId}:${params.correlationId}`;

    const begin = await this.webhookEvents.beginIngest({
      provider: TWILIO_PROVIDER,
      tenantId,
      correlationId: params.correlationId,
      externalDedupeKey,
      rawPayload: params.body,
    });

    if (begin.mode === 'duplicate') {
      this.logger.log(
        `twilio.webhook.duplicate_noop webhookEventId=${begin.event.id} correlationId=${params.correlationId} processed=${begin.event.processed}`,
      );
      return;
    }

    const smekIdempotencyKey = webhookEventIdempotencyKey(begin.event.id);
    const outcome = await this.applyCallStatusThroughSmek({
      tenantId,
      correlationId: params.correlationId,
      callStatus,
      idempotency: {
        key: smekIdempotencyKey,
        step: IdempotencyStep.WebhookTwilioVoiceStatus,
      },
      complianceThrows: true,
    });

    if (outcome.kind === 'noop') {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'twilio.voice.status',
        outcome: 'NO_SMEK_INTENT',
        reason: 'no_mapped_transition_or_no_state_change',
        callStatus,
      });
      return;
    }

    if (outcome.kind === 'ignored') {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'twilio.voice.status',
        outcome: 'IGNORED_DISALLOWED_TRANSITION',
        reason: outcome.reason,
        callStatus,
      });
      return;
    }

    if (outcome.kind === 'compliance_blocked') {
      await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
        kind: 'twilio.voice.status',
        outcome: outcome.result.outcome,
        blockCode: outcome.result.blockCode,
        message: outcome.result.message,
      });
      throw new ForbiddenException({
        outcome: outcome.result.outcome,
        blockCode: outcome.result.blockCode,
        message: outcome.result.message,
      });
    }

    await this.webhookEvents.markProcessed(tenantId, begin.event.id, {
      kind: 'twilio.voice.status',
      outcome: 'COMPLETED',
    });

    this.eventStream?.emit({
      occurredAt: new Date().toISOString(),
      envelope: 'WEBHOOK_EVENT',
      tenantId,
      correlationId: params.correlationId,
      provider: TWILIO_PROVIDER,
      kind: 'twilio.voice.status',
      outcome: 'COMPLETED',
      detail: { callStatus },
    });
  }

  private async applyCallStatusThroughSmek(params: {
    readonly tenantId: string;
    readonly correlationId: string;
    readonly callStatus: string;
    readonly idempotency: { readonly key: string; readonly step: string };
    readonly complianceThrows: boolean;
  }): Promise<CallVoiceRecoveryOutcome> {
    const latest = await this.callTransitions.getLatestCallToState(params.tenantId, params.correlationId);
    const resolvedFromState = latest ?? CallMachineState.INITIATED;

    const command = TwilioVoiceStatusToSmekMapper.tryBuildCommand({
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      resolvedFromState,
      callStatus: params.callStatus,
      borrowerOptedOut: false,
      idempotency: params.idempotency,
    });

    if (!command) {
      return { kind: 'noop' };
    }

    const from = command.transition.from;
    const to = command.transition.to;
    if (!this.isAllowedCallTransition(from, to)) {
      this.logger.warn(
        `twilio.call_status.ignored disallowed_transition from=${from} to=${to} callStatus=${params.callStatus} correlationId=${params.correlationId} idempotencyKey=${params.idempotency.key}`,
      );
      return { kind: 'ignored', reason: `disallowed ${from}→${to}` };
    }

    const result = await this.smekKernel.executeLoop(command);

    if (isSmekComplianceBlocked(result)) {
      if (params.complianceThrows) {
        return { kind: 'compliance_blocked', result };
      }
      this.logger.warn(
        `twilio.call_status.recovery_compliance_blocked correlationId=${params.correlationId} blockCode=${result.blockCode}`,
      );
      return { kind: 'compliance_blocked', result };
    }

    return { kind: 'applied' };
  }

  private isAllowedCallTransition(from: string, to: string): boolean {
    const def = this.machines.getDefinition(MachineKind.CALL);
    if (def.terminalStates.has(from)) {
      return false;
    }
    const allowed = def.transitions.get(from);
    return !!allowed?.has(to);
  }
}
