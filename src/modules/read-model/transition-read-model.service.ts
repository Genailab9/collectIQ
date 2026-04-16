import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SmekOrchestrationAuditEntity } from '../../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../../kernel/smek-orchestration-audit.kinds';
import { DataIngestionRecordEntity } from '../ingestion/entities/data-ingestion-record.entity';
import { PaymentMachineState } from '../../state-machine/definitions/payment-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { CallMachineState } from '../../state-machine/definitions/call-machine.definition';
import { ApprovalMachineState } from '../../state-machine/definitions/approval-machine.definition';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { SyncMachineState } from '../../state-machine/definitions/sync-machine.definition';
import { PiiEncryptionService } from '../../security/pii-encryption.service';

function safeJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class TransitionReadModelService {
  // LEGACY MIGRATION SURFACE: read-model access still relies on direct repository/query-builder usage during staged modernization.
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    @InjectRepository(DataIngestionRecordEntity)
    private readonly ingestionRecords: Repository<DataIngestionRecordEntity>,
    private readonly pii: PiiEncryptionService,
    private readonly config: ConfigService,
  ) {}

  async listPendingApprovals(tenantId: string): Promise<
    Array<{
      correlationId: string;
      tenantId: string;
      borrower: { name?: string; phone?: string; accountNumber?: string };
      negotiatedAmountCents: number | null;
      priority: { score?: number; label?: string } | null;
      currentState: string;
      /** Spec alias: APPROVAL@PENDING is the awaiting-officer queue. */
      queueStage: 'WAITING_APPROVAL';
    }>
  > {
    const t = tenantId.trim();
    const sql = `
      SELECT correlationId, to_state AS st
      FROM (
        SELECT correlationId, to_state,
          ROW_NUMBER() OVER (PARTITION BY correlationId ORDER BY occurredAt DESC, id DESC) rn
        FROM state_transition_log
        WHERE tenantId = ? AND machine = ?
      ) x
      WHERE rn = 1 AND st IN ('PENDING','REQUESTED','COUNTER','COUNTERED','TIMEOUT','ESCALATED')
    `;
    const rows = (await this.transitions.query(sql, [t, MachineKind.APPROVAL])) as Array<{
      correlationId: string;
      st: string;
    }>;
    const correlationIds = rows.map((r) => r.correlationId);
    const borrowerByCorrelation = await this.borrowerSnapshotsBatch(t, correlationIds);
    const negotiatedAmountByCorrelation = await this.negotiatedAmountsBatch(t, correlationIds);
    const priorityByCorrelation = await this.prioritiesFromDataBatch(t, correlationIds);
    const out: Awaited<ReturnType<TransitionReadModelService['listPendingApprovals']>> = [];
    for (const r of rows) {
      out.push({
        correlationId: r.correlationId,
        tenantId: t,
        borrower: borrowerByCorrelation.get(r.correlationId) ?? {},
        negotiatedAmountCents: negotiatedAmountByCorrelation.get(r.correlationId) ?? null,
        priority: priorityByCorrelation.get(r.correlationId) ?? null,
        currentState: r.st,
        queueStage: 'WAITING_APPROVAL',
      });
    }
    return out;
  }

  async listActiveExecutions(tenantId: string): Promise<
    Array<{
      correlationId: string;
      currentPhase: string;
      currentStateSummary: string;
      lastUpdatedAt: string;
      campaignId: string | null;
    }>
  > {
    const t = tenantId.trim();
    const sql = `
      SELECT DISTINCT s.correlationId AS correlationId
      FROM state_transition_log s
      WHERE s.tenantId = ?
      AND s.correlationId NOT IN (
        SELECT correlationId FROM (
          SELECT correlationId, to_state AS ts,
            ROW_NUMBER() OVER (PARTITION BY correlationId ORDER BY occurredAt DESC, id DESC) rn
          FROM state_transition_log
          WHERE tenantId = ? AND machine = ?
        ) z WHERE rn = 1 AND ts = ?
      )
    `;
    const ids = (await this.transitions.query(sql, [t, t, MachineKind.SYNC, SyncMachineState.COMPLETED])) as Array<{
      correlationId: string;
    }>;
    const correlationIds = ids.map((x) => x.correlationId);
    if (correlationIds.length === 0) {
      return [];
    }
    const recentTransitionsByCorrelation = await this.latestTransitionsBatch(t, correlationIds, 20);
    const campaignByCorrelation = await this.campaignIdsBatch(t, correlationIds);
    const result: Awaited<ReturnType<TransitionReadModelService['listActiveExecutions']>> = [];
    for (const correlationId of correlationIds) {
      const latestRows = recentTransitionsByCorrelation.get(correlationId) ?? [];
      if (latestRows.length === 0) {
        continue;
      }
      const last = latestRows[0]!;
      const byMachine = new Map<string, string>();
      for (const row of latestRows) {
        if (!byMachine.has(row.machine)) {
          byMachine.set(row.machine, row.toState);
        }
      }
      const phase = last.machine;
      const summary = [...byMachine.entries()].map(([m, s]) => `${m}:${s}`).join('|');
      result.push({
        correlationId,
        currentPhase: phase,
        currentStateSummary: summary,
        lastUpdatedAt: last.occurredAt.toISOString(),
        campaignId: campaignByCorrelation.get(correlationId) ?? null,
      });
    }
    return result;
  }

  async listPendingPayments(tenantId: string): Promise<
    Array<{
      correlationId: string;
      paymentId: string;
      amountCents: number | null;
      currentState: string;
    }>
  > {
    const t = tenantId.trim();
    const sql = `
      SELECT correlationId AS paymentId, to_state AS st
      FROM (
        SELECT correlationId, to_state,
          ROW_NUMBER() OVER (PARTITION BY correlationId ORDER BY occurredAt DESC, id DESC) rn
        FROM state_transition_log
        WHERE tenantId = ? AND machine = ?
      ) x
      WHERE rn = 1 AND st IN (?, ?)
    `;
    const rows = (await this.transitions.query(sql, [
      t,
      MachineKind.PAYMENT,
      PaymentMachineState.INITIATED,
      PaymentMachineState.PROCESSING,
    ])) as Array<{ paymentId: string; st: string }>;
    const paymentIds = rows.map((r) => r.paymentId);
    const amountByPaymentId = await this.paymentAmountsBatch(t, paymentIds);
    const out: Awaited<ReturnType<TransitionReadModelService['listPendingPayments']>> = [];
    for (const r of rows) {
      out.push({
        correlationId: r.paymentId,
        paymentId: r.paymentId,
        amountCents: amountByPaymentId.get(r.paymentId) ?? null,
        currentState: r.st,
      });
    }
    return out;
  }

  async dashboardMetrics(tenantId: string): Promise<{
    totalCases: number;
    collectedAmountCents: number;
    recoveryRate: number;
    avgResolutionTimeMs: number;
    approvalRate: number;
  }> {
    const t = tenantId.trim();
    const caseRow = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .getRawOne<{ c: string }>();
    const totalCases = Number.parseInt(caseRow?.c ?? '0', 10) || 0;

    const paySuccess = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.machine = :m', { m: MachineKind.PAYMENT })
      .andWhere('x.toState = :ok', { ok: PaymentMachineState.SUCCESS })
      .getRawOne<{ c: string }>();
    const successCases = Number.parseInt(paySuccess?.c ?? '0', 10) || 0;

    const dataDone = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.machine = :m', { m: MachineKind.DATA })
      .andWhere('x.toState = :done', { done: 'COMPLETED' })
      .getRawOne<{ c: string }>();
    const dataCompletedCases = Number.parseInt(dataDone?.c ?? '0', 10) || 0;

    const amountRow = await this.transitions
      .createQueryBuilder('x')
      .select("COALESCE(SUM(CAST(json_extract(x.metadataJson, '$.amountCents') AS INTEGER)), 0)", 'sumAmount')
      .where('x.tenantId = :t', { t })
      .andWhere('x.machine = :m', { m: MachineKind.PAYMENT })
      .andWhere('x.toState = :ok', { ok: PaymentMachineState.SUCCESS })
      .getRawOne<{ sumAmount: string | number | null }>();
    const collectedAmountCents = Number(amountRow?.sumAmount ?? 0) || 0;

    const resolutionSql = `
      SELECT AVG((strftime('%s', mx) - strftime('%s', mn)) * 1000) AS avgMs
      FROM (
        SELECT correlationId, MIN(occurredAt) AS mn, MAX(occurredAt) AS mx
        FROM state_transition_log
        WHERE tenantId = ?
        GROUP BY correlationId
      ) g
    `;
    const resRow = (await this.transitions.query(resolutionSql, [t])) as Array<{ avgMs: number | null }>;
    const avgResolutionTimeMs = Math.round(Number(resRow[0]?.avgMs ?? 0) || 0);

    const appr = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.machine = :m', { m: MachineKind.APPROVAL })
      .getRawOne<{ c: string }>();
    const hadApproval = Number.parseInt(appr?.c ?? '0', 10) || 0;
    const approved = await this.transitions
      .createQueryBuilder('x')
      .select('COUNT(DISTINCT x.correlationId)', 'c')
      .where('x.tenantId = :t', { t })
      .andWhere('x.machine = :m', { m: MachineKind.APPROVAL })
      .andWhere('x.toState = :ok', { ok: 'APPROVED' })
      .getRawOne<{ c: string }>();
    const approvedCases = Number.parseInt(approved?.c ?? '0', 10) || 0;

    return {
      totalCases,
      collectedAmountCents,
      recoveryRate: dataCompletedCases > 0 ? (successCases / dataCompletedCases) * 100 : 0,
      avgResolutionTimeMs,
      approvalRate: hadApproval > 0 ? (approvedCases / hadApproval) * 100 : 0,
    };
  }

  async listExecutionRetries(
    tenantId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<
    Array<{
      correlationId: string;
      failureReason: string;
      lastState: string;
      retryCount: number;
    }>
  > {
    const t = tenantId.trim();
    const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 500);
    const offset = Math.max(opts?.offset ?? 0, 0);
    const sql = `
WITH open_cases AS (
  SELECT correlationId FROM (
    SELECT correlationId, to_state AS ts,
      ROW_NUMBER() OVER (PARTITION BY correlationId ORDER BY occurredAt DESC, id DESC) rn
    FROM state_transition_log
    WHERE tenantId = ? AND machine = ?
  ) x WHERE rn = 1 AND ts != ?
),
latest AS (
  SELECT s.correlationId, s.machine, s.to_state AS ts,
    ROW_NUMBER() OVER (PARTITION BY s.correlationId, s.machine ORDER BY s.occurredAt DESC, s.id DESC) rn
  FROM state_transition_log s
  INNER JOIN open_cases o ON o.correlationId = s.correlationId
  WHERE s.tenantId = ?
),
hit AS (
  SELECT correlationId, machine, ts,
    CASE
      WHEN machine = ? AND ts IN (?, ?) THEN machine || ':' || ts
      WHEN machine = ? AND ts IN (?, ?) THEN machine || ':' || ts
      WHEN machine = ? AND ts = ? THEN machine || ':' || ts
      ELSE NULL
    END AS failureReason,
    machine || ':' || ts AS lastState
  FROM latest
  WHERE rn = 1
),
filtered AS (
  SELECT * FROM hit WHERE failureReason IS NOT NULL
)
SELECT f.correlationId,
       f.failureReason,
       f.lastState,
       IFNULL((
         SELECT COUNT(*) FROM state_transition_log x
         WHERE x.tenantId = ? AND x.correlationId = f.correlationId
           AND x.machine = ? AND x.to_state = ?
       ), 0)
       + IFNULL((
         SELECT COUNT(*) FROM state_transition_log x
         WHERE x.tenantId = ? AND x.correlationId = f.correlationId
           AND x.machine = ? AND x.to_state = ?
       ), 0) AS retryCount
FROM filtered f
ORDER BY f.correlationId DESC
LIMIT ? OFFSET ?
    `;
    const rows = (await this.transitions.query(sql, [
      t,
      MachineKind.SYNC,
      SyncMachineState.COMPLETED,
      t,
      MachineKind.CALL,
      CallMachineState.FAILED,
      CallMachineState.RETRY_SCHEDULED,
      MachineKind.PAYMENT,
      PaymentMachineState.FAILED,
      PaymentMachineState.RETRY,
      MachineKind.APPROVAL,
      ApprovalMachineState.TIMEOUT,
      t,
      MachineKind.CALL,
      CallMachineState.RETRY_SCHEDULED,
      t,
      MachineKind.PAYMENT,
      PaymentMachineState.RETRY,
      limit,
      offset,
    ])) as Array<{
      correlationId: string;
      failureReason: string;
      lastState: string;
      retryCount: number | string;
    }>;
    return rows.map((r) => ({
      correlationId: r.correlationId,
      failureReason: r.failureReason,
      lastState: r.lastState,
      retryCount: Number(r.retryCount ?? 0) || 0,
    }));
  }

  async approvalSlaMetrics(tenantId: string): Promise<{
    avgApprovalTimeMs: number;
    timeoutRate: number;
    pendingCount: number;
    breachedSlaCount: number;
  }> {
    const t = tenantId.trim();
    const pending = await this.listPendingApprovals(t);
    const pendingCount = pending.length;

    const timeouts = await this.transitions.count({
      where: { tenantId: t, machine: MachineKind.APPROVAL, toState: ApprovalMachineState.TIMEOUT },
    });
    const approved = await this.transitions.count({
      where: { tenantId: t, machine: MachineKind.APPROVAL, toState: ApprovalMachineState.APPROVED },
    });
    const denom = timeouts + approved;
    const timeoutRate = denom > 0 ? timeouts / denom : 0;

    const breachedSlaCount = await this.transitions.count({
      where: {
        tenantId: t,
        machine: MachineKind.APPROVAL,
        toState: In([ApprovalMachineState.TIMEOUT, ApprovalMachineState.ESCALATED]),
      },
    });

    const avgRow = (await this.transitions.query(
      `
      SELECT AVG((strftime('%s', b.occurredAt) - strftime('%s', a.occurredAt)) * 1000) AS ms
      FROM state_transition_log b
      JOIN (
        SELECT correlationId, MIN(occurredAt) AS startedAt
        FROM state_transition_log
        WHERE tenantId = ? AND machine = ? AND to_state IN ('REQUESTED','PENDING','COUNTER','COUNTERED')
        GROUP BY correlationId
      ) a ON a.correlationId = b.correlationId
      WHERE b.tenantId = ?
        AND b.machine = ?
        AND b.to_state = ?
        AND b.occurredAt >= a.startedAt
      `,
      [t, MachineKind.APPROVAL, t, MachineKind.APPROVAL, ApprovalMachineState.APPROVED],
    )) as Array<{ ms: number | null }>;
    const avgApprovalTimeMs = Math.round(Number(avgRow[0]?.ms ?? 0) || 0);

    return { avgApprovalTimeMs, timeoutRate, pendingCount, breachedSlaCount };
  }

  async observabilitySummary(tenantId: string): Promise<{
    failuresByPhase: Record<string, number>;
    adapterErrors: number;
    adapterRetryObservations: number;
    stuckExecutions: Array<{ correlationId: string; lastOccurredAt: string; idleMinutes: number }>;
  }> {
    const t = tenantId.trim();
    const stuckMinutes = Math.max(
      5,
      Number.parseInt(this.config.get<string>('COLLECTIQ_STUCK_EXECUTION_MINUTES') ?? '30', 10) || 30,
    );
    const errRows = await this.audits
      .createQueryBuilder('a')
      .select('a.executionPhase', 'phase')
      .addSelect('COUNT(*)', 'cnt')
      .where('a.tenantId = :t', { t })
      .andWhere('a.kind = :k', { k: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterError })
      .groupBy('a.executionPhase')
      .getRawMany<{ phase: string; cnt: string }>();
    const failuresByPhase: Record<string, number> = {};
    let adapterErrors = 0;
    for (const r of errRows) {
      const n = Number.parseInt(r.cnt, 10) || 0;
      failuresByPhase[r.phase] = n;
      adapterErrors += n;
    }

    const retryRows = await this.audits
      .createQueryBuilder('a')
      .where('a.tenantId = :t', { t })
      .andWhere('a.kind = :k', { k: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterSuccess })
      .andWhere("a.payloadJson LIKE '%\"attempt\":%'")
      .getCount();

    const stuckSql = `
      SELECT correlationId, MAX(occurredAt) AS lastAt
      FROM state_transition_log
      WHERE tenantId = ?
      GROUP BY correlationId
      HAVING (strftime('%s','now') - strftime('%s', MAX(occurredAt))) / 60.0 > ?
    `;
    const stuckRaw = (await this.transitions.query(stuckSql, [t, stuckMinutes])) as Array<{
      correlationId: string;
      lastAt: string;
    }>;
    const stuckExecutions = stuckRaw.map((r) => ({
      correlationId: r.correlationId,
      lastOccurredAt: new Date(r.lastAt).toISOString(),
      idleMinutes: Math.floor(
        (Date.now() - new Date(r.lastAt).getTime()) / 60_000,
      ),
    }));

    return {
      failuresByPhase,
      adapterErrors,
      adapterRetryObservations: retryRows,
      stuckExecutions,
    };
  }

  private async campaignIdsBatch(tenantId: string, correlationIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (correlationIds.length === 0) return out;
    const rows = await this.ingestionRecords.find({
      where: { tenantId, correlationId: In(correlationIds) },
      select: ['correlationId', 'campaignId'],
    });
    for (const row of rows) {
      out.set(row.correlationId, row.campaignId?.trim() || null);
    }
    return out;
  }

  private async borrowerSnapshotsBatch(
    tenantId: string,
    correlationIds: string[],
  ): Promise<Map<string, { name?: string; phone?: string; accountNumber?: string }>> {
    const out = new Map<string, { name?: string; phone?: string; accountNumber?: string }>();
    if (correlationIds.length === 0) return out;
    const rows = await this.ingestionRecords.find({
      where: { tenantId, correlationId: In(correlationIds) },
      select: ['correlationId', 'payloadSealed'],
    });
    for (const row of rows) {
      out.set(row.correlationId, this.decodeBorrowerSnapshot(row.payloadSealed));
    }
    return out;
  }

  private async negotiatedAmountsBatch(
    tenantId: string,
    correlationIds: string[],
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (correlationIds.length === 0) return out;
    const rows = await this.transitions.find({
      where: { tenantId, correlationId: In(correlationIds), machine: MachineKind.CALL },
      order: { occurredAt: 'DESC', id: 'DESC' },
      select: ['correlationId', 'metadataJson'],
    });
    for (const row of rows) {
      if (out.has(row.correlationId)) continue;
      const m = safeJson(row.metadataJson);
      if (!m) continue;
      const v = m.negotiatedAmountCents ?? m.offerAmountCents;
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.set(row.correlationId, v);
      }
    }
    return out;
  }

  private async prioritiesFromDataBatch(
    tenantId: string,
    correlationIds: string[],
  ): Promise<Map<string, { score?: number; label?: string } | null>> {
    const out = new Map<string, { score?: number; label?: string } | null>();
    if (correlationIds.length === 0) return out;
    const rows = await this.transitions.find({
      where: { tenantId, correlationId: In(correlationIds), machine: MachineKind.DATA },
      order: { occurredAt: 'DESC', id: 'DESC' },
      select: ['correlationId', 'metadataJson'],
    });
    for (const row of rows) {
      if (out.has(row.correlationId)) continue;
      const m = safeJson(row.metadataJson);
      if (!m) {
        out.set(row.correlationId, null);
        continue;
      }
      const score = typeof m.priorityScore === 'number' ? m.priorityScore : undefined;
      const label = typeof m.priorityLabel === 'string' ? m.priorityLabel : undefined;
      out.set(row.correlationId, score == null && label == null ? null : { score, label });
    }
    return out;
  }

  private async paymentAmountsBatch(tenantId: string, paymentIds: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (paymentIds.length === 0) return out;
    const rows = await this.transitions.find({
      where: { tenantId, correlationId: In(paymentIds), machine: MachineKind.PAYMENT },
      order: { occurredAt: 'ASC', id: 'ASC' },
      select: ['correlationId', 'metadataJson'],
    });
    for (const row of rows) {
      if (out.has(row.correlationId)) continue;
      const m = safeJson(row.metadataJson);
      const v = m?.amountCents;
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.set(row.correlationId, v);
      }
    }
    return out;
  }

  private async latestTransitionsBatch(
    tenantId: string,
    correlationIds: string[],
    perCorrelationLimit: number,
  ): Promise<Map<string, StateTransitionLogEntity[]>> {
    const out = new Map<string, StateTransitionLogEntity[]>();
    if (correlationIds.length === 0) return out;
    const n = Math.max(1, Math.min(50, perCorrelationLimit));
    const rows = (await this.transitions.query(
      `
      SELECT id, tenantId, correlationId, machine, from_state AS fromState, to_state AS toState, actor, metadataJson, occurredAt
      FROM (
        SELECT id, tenantId, correlationId, machine, from_state, to_state, actor, metadataJson, occurredAt,
               ROW_NUMBER() OVER (
                 PARTITION BY correlationId
                 ORDER BY occurredAt DESC, id DESC
               ) AS rn
        FROM state_transition_log
        WHERE tenantId = ? AND correlationId IN (${correlationIds.map(() => '?').join(',')})
      ) s
      WHERE s.rn <= ?
      ORDER BY correlationId, occurredAt DESC, id DESC
      `,
      [tenantId, ...correlationIds, n],
    )) as Array<StateTransitionLogEntity>;
    for (const row of rows) {
      const bucket = out.get(row.correlationId) ?? [];
      bucket.push(row);
      out.set(row.correlationId, bucket);
    }
    return out;
  }

  private decodeBorrowerSnapshot(payloadSealed: string): {
    name?: string;
    phone?: string;
    accountNumber?: string;
  } {
    try {
      const json = this.pii.openUtf8(payloadSealed);
      const o = JSON.parse(json) as Record<string, unknown>;
      const name =
        (typeof o.name === 'string' && o.name) ||
        (typeof o.account_number === 'string' && o.account_number) ||
        undefined;
      const phone = typeof o.phone === 'string' ? o.phone : undefined;
      const accountNumber = typeof o.account_number === 'string' ? o.account_number : undefined;
      return { name, phone, accountNumber };
    } catch {
      return {};
    }
  }

}
