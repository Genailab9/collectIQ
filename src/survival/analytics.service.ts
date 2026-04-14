import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { MachineKind } from '../state-machine/types/machine-kind';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { TraceExecutionService } from '../observability/trace-execution.service';

export type AnalyticsDashboardDto = {
  readonly tenantId: string;
  readonly windowDays: number;
  readonly sinceIso: string;
  readonly caseCount: number;
  readonly paymentSuccessDistinct: number;
  readonly latestStateByMachine: Record<string, Record<string, number>>;
  readonly transitionTotalsByMachine: Record<string, number>;
  readonly auditRowCount: number;
  readonly complianceAuditRows: number;
};

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    private readonly traces: TraceExecutionService,
  ) {}

  async dashboard(tenantId: string, windowDays = 30): Promise<AnalyticsDashboardDto> {
    const t = tenantId.trim();
    const days = Math.min(365, Math.max(1, Math.floor(windowDays)));
    const since = new Date(Date.now() - days * 86_400_000);

    const caseRow = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.occurredAt >= :since', { since })
      .getRawOne<{ c: string }>();
    const caseCount = Number.parseInt(caseRow?.c ?? '0', 10) || 0;

    const payRow = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.machine = :m', { m: MachineKind.PAYMENT })
      .andWhere('x.toState = :ok', { ok: 'SUCCESS' })
      .andWhere('x.occurredAt >= :since', { since })
      .getRawOne<{ c: string }>();
    const paymentSuccessDistinct = Number.parseInt(payRow?.c ?? '0', 10) || 0;

    const latestSql = `
      SELECT machine, toState AS state, COUNT(*) AS cnt
      FROM (
        SELECT correlationId, machine, toState,
          ROW_NUMBER() OVER (PARTITION BY correlationId, machine ORDER BY occurredAt DESC, id DESC) AS rn
        FROM state_transition_log
        WHERE tenantId = ? AND occurredAt >= ?
      ) z
      WHERE z.rn = 1
      GROUP BY machine, toState
    `;
    const latestRows = (await this.transitions.query(latestSql, [t, since])) as Array<{
      machine: string;
      state: string;
      cnt: number;
    }>;

    const latestStateByMachine: Record<string, Record<string, number>> = {};
    for (const row of latestRows) {
      if (!latestStateByMachine[row.machine]) {
        latestStateByMachine[row.machine] = {};
      }
      latestStateByMachine[row.machine]![row.state] =
        (latestStateByMachine[row.machine]![row.state] ?? 0) + Number(row.cnt);
    }

    const totalsRows = await this.transitions
      .createQueryBuilder('x')
      .select('x.machine', 'machine')
      .addSelect('COUNT(*)', 'cnt')
      .where('x.tenantId = :t', { t })
      .andWhere('x.occurredAt >= :since', { since })
      .groupBy('x.machine')
      .getRawMany<{ machine: string; cnt: string }>();

    const transitionTotalsByMachine: Record<string, number> = {};
    for (const r of totalsRows) {
      transitionTotalsByMachine[r.machine] = Number.parseInt(r.cnt, 10) || 0;
    }

    const auditRowCount = await this.audits.count({
      where: { tenantId: t },
    });

    const complianceAuditRows = await this.audits
      .createQueryBuilder('a')
      .where('a.tenantId = :t', { t })
      .andWhere('a.createdAt >= :since', { since })
      .andWhere('(a.kind LIKE :c1 OR a.kind LIKE :c2)', { c1: '%COMPLIANCE%', c2: '%BLOCK%' })
      .getCount();

    return {
      tenantId: t,
      windowDays: days,
      sinceIso: since.toISOString(),
      caseCount,
      paymentSuccessDistinct,
      latestStateByMachine,
      transitionTotalsByMachine,
      auditRowCount,
      complianceAuditRows,
    };
  }

  async campaign(tenantId: string, campaignId: string): Promise<{
    tenantId: string;
    campaignId: string;
    correlationIds: string[];
    aggregates: {
      caseCount: number;
      paymentSuccessDistinct: number;
      latestStateByMachine: Record<string, Record<string, number>>;
    };
  }> {
    const t = tenantId.trim();
    const c = campaignId.trim();
    if (!c) {
      throw new NotFoundException('campaign id required');
    }

    const idSql = `
      SELECT DISTINCT correlationId AS cid
      FROM state_transition_log
      WHERE tenantId = ?
        AND machine = ?
        AND metadataJson IS NOT NULL
        AND json_valid(metadataJson)
        AND lower(json_extract(metadataJson, '$.campaignId')) = lower(?)
    `;
    const idRows = (await this.transitions.query(idSql, [t, MachineKind.DATA, c])) as Array<{ cid: string }>;
    const correlationIds = idRows.map((r) => r.cid).filter(Boolean);
    if (correlationIds.length === 0) {
      return {
        tenantId: t,
        campaignId: c,
        correlationIds: [],
        aggregates: {
          caseCount: 0,
          paymentSuccessDistinct: 0,
          latestStateByMachine: {},
        },
      };
    }

    const latestSql = `
      SELECT machine, toState AS state, COUNT(*) AS cnt
      FROM (
        SELECT correlationId, machine, toState,
          ROW_NUMBER() OVER (PARTITION BY correlationId, machine ORDER BY occurredAt DESC, id DESC) AS rn
        FROM state_transition_log
        WHERE tenantId = ? AND correlationId IN (${correlationIds.map(() => '?').join(',')})
      ) z
      WHERE z.rn = 1
      GROUP BY machine, toState
    `;
    const latestRows = (await this.transitions.query(latestSql, [t, ...correlationIds])) as Array<{
      machine: string;
      state: string;
      cnt: number;
    }>;
    const latestStateByMachine: Record<string, Record<string, number>> = {};
    for (const row of latestRows) {
      if (!latestStateByMachine[row.machine]) {
        latestStateByMachine[row.machine] = {};
      }
      latestStateByMachine[row.machine]![row.state] =
        (latestStateByMachine[row.machine]![row.state] ?? 0) + Number(row.cnt);
    }

    const payRow = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.correlationId IN (:...ids)', { ids: correlationIds })
      .andWhere('x.machine = :m', { m: MachineKind.PAYMENT })
      .andWhere('x.toState = :ok', { ok: 'SUCCESS' })
      .getRawOne<{ c: string }>();
    const paymentSuccessDistinct = Number.parseInt(payRow?.c ?? '0', 10) || 0;

    return {
      tenantId: t,
      campaignId: c,
      correlationIds,
      aggregates: {
        caseCount: correlationIds.length,
        paymentSuccessDistinct,
        latestStateByMachine,
      },
    };
  }

  /** Authoritative case view: same assembly rules as observability trace (transitions + audit). */
  async caseTruth(tenantId: string, correlationId: string) {
    const t = tenantId.trim();
    const c = correlationId.trim();
    return this.traces.traceExecution(t, c);
  }
}
