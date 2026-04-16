import { Controller, ForbiddenException, Get, Headers, Logger, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../tenant/tenant-context.service';
import { TransitionReadModelService } from '../modules/read-model/transition-read-model.service';
import { TenantFeatureFlagService } from '../modules/tenant-feature-flags/tenant-feature-flag.service';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceExecutionService } from './trace-execution.service';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import type { ExecutionTraceDto, ExecutionTraceSummaryDto } from './trace-execution.dto';
import { DomainEventsQueryDto } from './domain-events.dto';
import { DomainEventsService } from './domain-events.service';
import { SystemEventProjectionService } from './system-event-projection.service';
import { PolicyContextBuilderService } from '../policy/policy-context-builder.service';
import { PolicyDecisionAuditService } from '../policy/policy-decision-audit.service';
import { PolicyEvaluatorService } from '../policy/policy-evaluator.service';
import { PolicyModeService } from '../policy/policy-mode.service';
import { GENERATED_POLICY_CONTRACT } from '../policy/generated-policy-contract';

@Controller(['observability', 'api/v1/observability'])
export class ObservabilityController {
  private readonly logger = new Logger(ObservabilityController.name);

  constructor(
    private readonly traces: TraceExecutionService,
    private readonly tenantContext: TenantContextService,
    private readonly structured: StructuredLoggerService,
    private readonly readModel: TransitionReadModelService,
    private readonly domainEventsService: DomainEventsService,
    private readonly systemEventProjection: SystemEventProjectionService,
    private readonly tenantFlags: TenantFeatureFlagService,
    private readonly config: ConfigService,
    private readonly metrics: PrometheusMetricsService,
    private readonly policyContextBuilder: PolicyContextBuilderService,
    private readonly policyAudit: PolicyDecisionAuditService,
    private readonly policies: PolicyEvaluatorService,
    private readonly policyMode: PolicyModeService,
  ) {}

  @Get('summary')
  async summary() {
    this.metrics.incApiRequestsTotal('observability', 'summary');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'summary');
    const started = Date.now();
    try {
      return this.readModel.observabilitySummary(tenantId);
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'summary', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('observability', 'summary', Date.now() - started);
    }
  }

  /**
   * PRD §12 — trace tiers:
   * - summary (default): lightweight timeline + current state + counters
   * - full (debug): includes decrypted audit payloads + webhook payloads
   */
  @Get('trace/:correlationId')
  async getTrace(
    @Param('correlationId') correlationId: string,
    @Query('mode') mode?: 'summary' | 'full',
    @Headers('x-collectiq-debug') debugHeader?: string,
    @Headers('x-collectiq-admin-key') adminKeyHeader?: string,
    @Headers('x-collectiq-admin-actor') adminActorHeader?: string,
    @Headers('x-collectiq-admin-role') adminRoleHeader?: string,
  ): Promise<ExecutionTraceDto | ExecutionTraceSummaryDto> {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('observability', 'trace');
    const tenantId = this.tenantContext.getRequired();
    const m = mode === 'full' ? 'full' : 'summary';
    if (m === 'summary') {
      this.enforceObservabilityReadPolicy(tenantId, 'trace_summary', correlationId);
    }
    if (m === 'summary') this.metrics.incTraceSummaryRequest();
    else this.metrics.incTraceFullRequest();
    if (m === 'full') {
      const expectedAdminKey = this.config.get<string>('COLLECTIQ_ADMIN_API_KEY')?.trim() ?? '';
      const traceFullDisabledByKillSwitch = this.config.get<string>('DISABLE_TRACE_FULL')?.trim().toLowerCase() === 'true';
      const killSwitchDisabled = !traceFullDisabledByKillSwitch;
      const tenantFlagEnabled = await this.tenantFlags.getBoolean(tenantId, 'ALLOW_TRACE_FULL', false);
      const policyContext = this.policyContextBuilder.buildTraceFullContext({
        tenantId,
        correlationId,
        debugHeader,
        adminKeyHeader,
        adminActorHeader,
        adminRoleHeader,
        expectedAdminApiKey: expectedAdminKey,
        tenantFlagEnabled,
        traceFullDisabledByKillSwitch,
      });
      const debugEnabled = policyContext.debugEnabled === true;
      const hasPrivilegedIdentity = policyContext.actor.isPrivilegedIdentity === true;
      const legacyAllowed = debugEnabled && hasPrivilegedIdentity && killSwitchDisabled && tenantFlagEnabled;
      const policy = this.policies.evaluate(policyContext);
      const policyAllowed = policy.decision === 'ALLOW';

      const evaluatorMode = this.policyMode.getMode();
      const effectiveAllowed = policyAllowed;
      if (evaluatorMode === 'shadow' && legacyAllowed !== policyAllowed) {
        this.logPolicyMismatchIfAny({
          tenantId,
          correlationId,
          legacyAllowed,
          policyAllowed,
          policyReason: policy.reason,
        });
      }
      this.policyAudit.record({
        context: policyContext,
        decision: policy,
        evaluatorMode,
        legacyAllowed,
        effectiveAllowed,
      });
      if (evaluatorMode === 'legacy_deprecated') {
        this.logger.warn(
          `policy_mode_legacy_deprecated action=trace_full tenantId=${tenantId} correlationId=${correlationId} policy=${policyAllowed ? 'ALLOW' : 'DENY'} legacy=${legacyAllowed ? 'ALLOW' : 'DENY'} reason=${policy.reason}`,
        );
      }
      if (!effectiveAllowed) {
        this.metrics.incApiErrorsTotal('observability', `trace_${m}`, 'policy_denied');
        if (!killSwitchDisabled) {
          throw new ForbiddenException({
            code: 'TRACE_FULL_DISABLED',
            policyVersion: policy.policyVersion,
            policyContractVersion: policy.policyContractVersion,
            message: 'Full trace is disabled by platform configuration.',
          });
        }
        throw new ForbiddenException({
          code: 'TRACE_FULL_FORBIDDEN',
          policyVersion: policy.policyVersion,
          policyContractVersion: policy.policyContractVersion,
          message:
            !debugEnabled
              ? 'Full trace requires X-CollectIQ-Debug: true.'
              : !hasPrivilegedIdentity
                ? 'Full trace requires privileged admin identity.'
                : 'Full trace is not enabled for this tenant.',
        });
      }
    }
    try {
      if (m === 'full') {
        return this.traces.traceExecutionFull(tenantId, correlationId);
      }
      return this.traces.traceExecutionSummary(tenantId, correlationId);
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', `trace_${m}`, 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('observability', `trace_${m}`, Date.now() - started);
    }
  }

  /** Phase 4 — bounded in-memory export; optional correlationId filter within the ring buffer. */
  @Get('structured-log-export')
  async structuredExport(
    @Query('limit') limit?: string,
    @Query('correlationId') correlationId?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('observability', 'structured_export');
    const tenantId = this.tenantContext.getRequired().trim();
    const c = correlationId?.trim();
    this.enforceObservabilityReadPolicy(tenantId, 'structured_export', c);
    const lim = limit ? Number.parseInt(limit, 10) : 500;
    try {
      return {
        events: await this.structured.exportRecentStructuredAsync(
          tenantId,
          Number.isFinite(lim) ? lim : 500,
          c || undefined,
        ),
      };
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'structured_export', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('observability', 'structured_export', Date.now() - started);
    }
  }

  @Get('domain-events')
  async listDomainEvents(@Query() query: DomainEventsQueryDto) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('observability', 'domain_events');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'domain_events', query.correlationId);
    const limit = query.limit ?? 50;
    try {
      return this.domainEventsService.listDomainEvents({
        tenantId,
        correlationId: query.correlationId,
        eventType: query.eventType,
        limit,
      });
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'domain_events', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('observability', 'domain_events', Date.now() - started);
    }
  }

  @Get('incident/:correlationId/timeline')
  async incidentTimeline(
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
  ) {
    const started = Date.now();
    this.metrics.incApiRequestsTotal('observability', 'incident_timeline');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'incident_timeline', correlationId);
    const lim = limit ? Number.parseInt(limit, 10) : 500;
    try {
      return this.systemEventProjection.readIncidentTimeline(
        tenantId,
        correlationId,
        Number.isFinite(lim) ? lim : 500,
      );
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'incident_timeline', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeApiLatencyMs('observability', 'incident_timeline', Date.now() - started);
    }
  }

  @Get('replay/:correlationId')
  async replay(
    @Param('correlationId') correlationId: string,
    @Query('fromSeq') fromSeq?: string,
    @Query('limit') limit?: string,
  ) {
    const started = Date.now();
    this.metrics.incReplayRequests('timeline');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'replay', correlationId);
    const lim = limit ? Number.parseInt(limit, 10) : 500;
    const from = fromSeq ? Number.parseInt(fromSeq, 10) : 0;
    try {
      const timeline = await this.systemEventProjection.readProjectedOnly(
        tenantId,
        correlationId,
        Number.isFinite(lim) ? lim : 500,
        Number.isFinite(from) ? from : 0,
      );
      const integrity = await this.systemEventProjection.checkIntegrity(tenantId, correlationId);
      return {
        policyVersion: GENERATED_POLICY_CONTRACT.policyVersion,
        policyContractVersion: GENERATED_POLICY_CONTRACT.version,
        integrity: integrity.status,
        eventCount: timeline.events.length,
        nextSeq: (timeline.events[timeline.events.length - 1]?.seq ?? (Number.isFinite(from) ? from : 0)) + 1,
        ...timeline,
      };
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'replay_timeline', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeReplayLatencyMs('timeline', Date.now() - started);
    }
  }

  @Get('replay/:correlationId/integrity')
  async replayIntegrity(@Param('correlationId') correlationId: string) {
    const started = Date.now();
    this.metrics.incReplayRequests('integrity');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'replay_integrity', correlationId);
    try {
      const integrity = await this.systemEventProjection.checkIntegrity(tenantId, correlationId);
      if (integrity.status === 'BROKEN') {
        this.metrics.incProjectionIntegrityErrors('replay_integrity_broken');
        this.metrics.incReplayIntegrityFailures('broken');
      }
      return integrity;
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'replay_integrity', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeReplayLatencyMs('integrity', Date.now() - started);
    }
  }

  @Get('decision/:decisionId/trace')
  async decisionTrace(@Param('decisionId') decisionId: string, @Query('limit') limit?: string) {
    const started = Date.now();
    this.metrics.incReplayRequests('decision_trace');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'decision_trace', decisionId);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 500;
    const boundedLimit = Number.isFinite(parsedLimit) ? Math.min(500, parsedLimit) : 500;
    try {
      const events = await this.systemEventProjection.readDecisionTrace(
        tenantId,
        decisionId,
        boundedLimit,
      );
      return {
        decisionId: decisionId.trim(),
        tenantId,
        eventCount: events.length,
        truncated: events.length >= boundedLimit,
        events,
      };
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'decision_trace', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeReplayLatencyMs('decision_trace', Date.now() - started);
    }
  }

  @Get('replay/:correlationId/chain')
  async replayChain(@Param('correlationId') correlationId: string) {
    const started = Date.now();
    this.metrics.incReplayRequests('chain');
    const tenantId = this.tenantContext.getRequired();
    this.enforceObservabilityReadPolicy(tenantId, 'replay_chain', correlationId);
    try {
      return this.systemEventProjection.readChainAnchors(tenantId, correlationId);
    } catch (error) {
      this.metrics.incApiErrorsTotal('observability', 'replay_chain', 'request_failed');
      throw error;
    } finally {
      this.metrics.observeReplayLatencyMs('chain', Date.now() - started);
    }
  }

  private logPolicyMismatchIfAny(params: {
    tenantId: string;
    correlationId: string;
    legacyAllowed: boolean;
    policyAllowed: boolean;
    policyReason: string;
  }): void {
    if (params.legacyAllowed === params.policyAllowed) {
      return;
    }
    this.logger.warn(
      `policy_shadow_mismatch action=trace_full tenantId=${params.tenantId} correlationId=${params.correlationId} legacy=${params.legacyAllowed ? 'ALLOW' : 'DENY'} policy=${params.policyAllowed ? 'ALLOW' : 'DENY'} reason=${params.policyReason}`,
    );
  }

  private enforceObservabilityReadPolicy(
    tenantId: string,
    endpoint: string,
    correlationId?: string,
  ): void {
    const context = this.policyContextBuilder.buildTenantOperationContext({
      tenantId,
      correlationId: correlationId?.trim() || `observability:${endpoint}`,
      operationType: 'READ',
      resourceType: 'TENANT',
      executionSurface: 'API',
      riskTier: 'HIGH',
      actorRole: 'TENANT',
    });
    const decision = this.policies.evaluate(context);
    const policyAllowed = decision.decision === 'ALLOW';
    const evaluatorMode = this.policyMode.getMode();
    const legacyAllowed = true;
    const effectiveAllowed = policyAllowed;
    if (evaluatorMode === 'shadow' && legacyAllowed !== policyAllowed) {
      this.logger.warn(
        `policy_shadow_mismatch action=observability_${endpoint} tenantId=${tenantId} legacy=ALLOW policy=${policyAllowed ? 'ALLOW' : 'DENY'} reason=${decision.reason}`,
      );
    }
    this.policyAudit.record({
      context,
      decision,
      evaluatorMode,
      legacyAllowed,
      effectiveAllowed,
    });
    if (!effectiveAllowed) {
      throw new ForbiddenException({
        code: 'OBSERVABILITY_POLICY_DENIED',
        policyVersion: decision.policyVersion,
        policyContractVersion: decision.policyContractVersion,
        message: `Policy denied observability access: ${endpoint}.`,
      });
    }
  }

}
