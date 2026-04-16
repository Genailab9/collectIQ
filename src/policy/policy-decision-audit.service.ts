import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import type { PolicyDecisionResult } from './policy-evaluator.service';
import type { PolicyRequestContext } from './policy-context';

@Injectable()
export class PolicyDecisionAuditService {
  constructor(private readonly structured: StructuredLoggerService) {}

  record(params: {
    context: PolicyRequestContext;
    decision: PolicyDecisionResult;
    evaluatorMode: 'shadow' | 'enforce' | 'legacy_deprecated';
    legacyAllowed?: boolean;
    effectiveAllowed: boolean;
  }): void {
    const c = params.context;
    const decisionId = randomUUID();
    const reasonCode = params.decision.reason.trim().toUpperCase();
    const contextHash = createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: c.tenantId,
          correlationId: c.correlationId ?? null,
          operationType: c.operationType,
          resourceType: c.resourceType,
          executionSurface: c.executionSurface,
          riskTier: c.riskTier,
          originClass: c.originClass,
          actor: c.actor,
          debugEnabled: c.debugEnabled ?? null,
          flags: c.flags ?? null,
          killSwitches: c.killSwitches ?? null,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    this.structured.emit({
      correlationId: c.correlationId ?? 'n/a',
      tenantId: c.tenantId,
      phase: 'POLICY',
      state: `${c.resourceType}:${c.operationType}`,
      adapter: 'policy.evaluator',
      result: `POLICY_${params.decision.decision}`,
      surface: c.executionSurface,
      message: [
        `origin=${c.originClass}`,
        `risk=${c.riskTier}`,
        `mode=${params.evaluatorMode}`,
        `policyVersion=${params.decision.policyVersion}`,
        `reasonCode=${reasonCode}`,
        `decisionId=${decisionId}`,
        `contextHash=${contextHash}`,
        `surfaceType=${c.executionSurface}`,
        `effective=${params.effectiveAllowed ? 'ALLOW' : 'DENY'}`,
        params.legacyAllowed === undefined ? undefined : `legacy=${params.legacyAllowed ? 'ALLOW' : 'DENY'}`,
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
}
