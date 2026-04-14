import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKeyEntity } from '../idempotency/entities/idempotency-key.entity';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import type {
  ExecutionAdapterCallTraceDto,
  ExecutionErrorTraceDto,
  ExecutionTraceDto,
  ExecutionTransitionTraceDto,
} from './trace-execution.dto';

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { parseError: true, rawSnippet: raw.slice(0, 500) };
  }
}

/**
 * PRD §12 — assemble transition history, adapter audit rows, and idempotency failures for an execution.
 */
@Injectable()
export class TraceExecutionService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    @InjectRepository(IdempotencyKeyEntity)
    private readonly idempotencyRows: Repository<IdempotencyKeyEntity>,
    private readonly cipher: AtRestCipherService,
  ) {}

  async traceExecution(tenantId: string, correlationId: string): Promise<ExecutionTraceDto> {
    const t = tenantId.trim();
    const c = correlationId.trim();

    const transitionRows = await this.transitions.find({
      where: { tenantId: t, correlationId: c },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });

    const transitions: ExecutionTransitionTraceDto[] = transitionRows.map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      machine: row.machine,
      from: row.fromState,
      to: row.toState,
      actor: row.actor,
      metadataJson: row.metadataJson,
    }));

    const auditRows = await this.audits.find({
      where: { tenantId: t, correlationId: c },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const adapterCalls: ExecutionAdapterCallTraceDto[] = [];
    const errors: ExecutionErrorTraceDto[] = [];

    for (const row of auditRows) {
      const plaintext = this.cipher.openPayloadJson(row.payloadJson);
      const payload = safeJsonParse(plaintext);
      adapterCalls.push({
        createdAt: row.createdAt.toISOString(),
        auditKind: row.kind,
        executionPhase: row.executionPhase,
        payload,
      });
      if (
        (row.kind === SMEK_ORCHESTRATION_AUDIT_KIND.AdapterResult ||
          row.kind === SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError) &&
        payload &&
        typeof payload === 'object'
      ) {
        const ar = (payload as { adapterResult?: { error?: string; reason?: string } }).adapterResult;
        const lifecycleError =
          row.kind === SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError
            ? (payload as { error?: string }).error
            : undefined;
        const msg =
          lifecycleError ??
          (ar && typeof ar === 'object' ? ar.error ?? ar.reason : undefined);
        if (typeof msg === 'string' && msg.trim()) {
          errors.push({
            source: 'smek_orchestration_audit',
            at: row.createdAt.toISOString(),
            detail: `${row.executionPhase}: ${msg.trim()}`,
          });
        }
      }
    }

    const failedIdem = await this.idempotencyRows.find({
      where: { tenantId: t, correlationId: c, status: 'failed' },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });

    for (const row of failedIdem) {
      errors.push({
        source: 'idempotency_keys',
        at: row.updatedAt.toISOString(),
        detail: `step=${row.step} idempotencyKey=${row.idempotencyKey}`,
      });
    }

    return {
      tenantId: t,
      correlationId: c,
      transitions,
      adapterCalls,
      errors,
    };
  }
}
