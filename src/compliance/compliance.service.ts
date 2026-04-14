import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionFeatureFlagsService } from '../modules/tenant-feature-flags/execution-feature-flags.service';
import { ExecutionLoopPhase } from '../contracts/execution-loop-phase';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { CallMachineState } from '../state-machine/definitions/call-machine.definition';
import { MachineKind } from '../state-machine/types/machine-kind';
import {
  PRD_CALL_WINDOW_END_HOUR_PKT,
  PRD_CALL_WINDOW_START_HOUR_PKT,
  PRD_CALL_WINDOW_TIMEZONE,
} from './compliance.constants';
import { ComplianceBlockedError, ComplianceGateInvalidError } from './compliance.errors';
import type { ComplianceGateInput } from './compliance.types';
import { TenantCompliancePolicyEntity } from './entities/tenant-compliance-policy.entity';

/**
 * Global pre-transition compliance gate (PRD v1.1 §11). Fail-closed: violations throw.
 * SMEK wraps calls and may return `COMPLIANCE_BLOCKED` without persisting transitions.
 */
@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(TenantCompliancePolicyEntity)
    private readonly tenantPolicies: Repository<TenantCompliancePolicyEntity>,
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    private readonly executionFlags: ExecutionFeatureFlagsService,
  ) {}

  /**
   * Invoked by SMEK before any transition or adapter side-effect. No bypass paths.
   */
  async assertCompliant(gate: ComplianceGateInput): Promise<void> {
    const tenantId = gate.tenantId.trim();
    const correlationId = gate.correlationId.trim();
    if (!tenantId || !correlationId) {
      throw new ComplianceGateInvalidError('tenantId and correlationId are required.');
    }

    if (gate.borrowerOptedOut === true) {
      throw new ComplianceBlockedError(
        'Execution is blocked because the borrower has opted out.',
        'borrower_opt_out',
      );
    }

    const policy = await this.loadPolicyOrThrow(tenantId);
    if (policy.tenantId !== tenantId) {
      throw new ComplianceBlockedError('Tenant isolation violation for compliance policy row.', 'tenant_isolation');
    }

    if (!policy.enabled) {
      throw new ComplianceBlockedError(
        `Compliance policy is disabled for tenant "${tenantId}".`,
        'tenant_policy_disabled',
      );
    }

    await this.assertPrdCallWindowPktIfApplicable(gate, policy);
    await this.assertCallRetryLimitsIfApplicable(gate, tenantId, correlationId, policy);
  }

  private async loadPolicyOrThrow(tenantId: string): Promise<TenantCompliancePolicyEntity> {
    const policy = await this.tenantPolicies.findOneBy({ tenantId });
    if (!policy) {
      throw new ComplianceBlockedError(
        `No compliance policy is configured for tenant "${tenantId}".`,
        'tenant_policy_missing',
      );
    }
    return policy;
  }

  /**
   * PRD v1.1 §11.1 — current time in PKT must fall within the global 9–20 band and the tenant’s narrower
   * window (also expressed in PKT hours, persisted on `tenant_compliance_policy`).
   */
  private async assertPrdCallWindowPktIfApplicable(
    gate: ComplianceGateInput,
    policy: TenantCompliancePolicyEntity,
  ): Promise<void> {
    const phase = gate.executionPhase;
    if (phase !== ExecutionLoopPhase.CALL && phase !== ExecutionLoopPhase.AUTHENTICATE) {
      return;
    }
    if (await this.executionFlags.isJsonTruthy(gate.tenantId, 'DEMO_MODE')) {
      return;
    }

    const start = policy.callWindowStartHourLocal;
    const end = policy.callWindowEndHourLocal;
    if (start > end) {
      throw new ComplianceGateInvalidError(
        'Tenant call window must not wrap midnight (PRD §11.1 PKT evaluation expects start <= end).',
      );
    }
    if (
      start < PRD_CALL_WINDOW_START_HOUR_PKT ||
      end > PRD_CALL_WINDOW_END_HOUR_PKT ||
      start < 0 ||
      end > 23
    ) {
      throw new ComplianceGateInvalidError(
        `Tenant call window must lie within PRD PKT hours [${PRD_CALL_WINDOW_START_HOUR_PKT}, ${PRD_CALL_WINDOW_END_HOUR_PKT}] (tenant=${gate.tenantId}).`,
      );
    }

    const hour = this.getLocalHour(new Date(), PRD_CALL_WINDOW_TIMEZONE);
    if (!this.isHourWithinInclusiveWindow(hour, start, end)) {
      throw new ComplianceBlockedError(
        `Call window violation: PKT hour ${hour} is outside permitted window [${start}, ${end}] (PRD §11.1, tenant=${gate.tenantId}).`,
        'call_time_window_pkt',
      );
    }
  }

  private async assertCallRetryLimitsIfApplicable(
    gate: ComplianceGateInput,
    tenantId: string,
    correlationId: string,
    policy: TenantCompliancePolicyEntity,
  ): Promise<void> {
    if (await this.executionFlags.isJsonTruthy(tenantId, 'DEMO_MODE')) {
      return;
    }
    if (gate.proposedMachine !== MachineKind.CALL) {
      return;
    }
    if (gate.proposedFrom !== CallMachineState.INITIATED) {
      return;
    }

    const count = await this.transitions.count({
      where: {
        tenantId,
        correlationId,
        machine: MachineKind.CALL,
        fromState: CallMachineState.INITIATED,
      },
    });

    if (count >= policy.maxCallAttemptsFromInitiated) {
      throw new ComplianceBlockedError(
        `Call retry limit exceeded for correlation "${correlationId}" (count=${count}, max=${policy.maxCallAttemptsFromInitiated}).`,
        'call_retry_limit',
      );
    }
  }

  private assertValidIanaTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).formatToParts(new Date());
    } catch {
      throw new ComplianceGateInvalidError(`Invalid IANA time zone: "${timeZone}".`);
    }
  }

  private getLocalHour(at: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone,
    }).formatToParts(at);
    const hourPart = parts.find((p) => p.type === 'hour');
    const hour = Number(hourPart?.value);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new ComplianceGateInvalidError('Unable to resolve local hour for compliance evaluation.');
    }
    return hour;
  }

  private isHourWithinInclusiveWindow(hour: number, start: number, end: number): boolean {
    return hour >= start && hour <= end;
  }
}
