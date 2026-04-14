import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmekOrchestrationAuditEntity } from '../../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../../kernel/smek-orchestration-audit.kinds';
import { DataIngestionRecordEntity } from '../ingestion/entities/data-ingestion-record.entity';
import { PaymentMachineState } from '../../state-machine/definitions/payment-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
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
      SELECT correlationId, toState AS st
      FROM (
        SELECT correlationId, toState,
          ROW_NUMBER() OVER (PARTITION BY correlationId ORDER BY occurredAt DESC, id DESC) rn
        FROM state_transition_log
        WHERE tenantId = ? AND machine = ?
      ) x
      WHERE rn = 1 AND st IN ('PENDING','REQUESTED','COUNTERED','TIMEOUT','ESCALATED')
    `;
    const rows = (await this.transitions.query(sql, [t, MachineKind.APPROVAL])) as Array<{
      correlationId: string;
      st: string;
    }>;
    const out: Awaited<ReturnType<TransitionReadModelService['listPendingApprovals']>> = [];
    for (const r of rows) {
      const borrower = await this.borrowerSnapshot(t, r.correlationId);
      const negotiatedAmountCents = await this.negotiatedAmountCents(t, r.correlationId);
      const priority = await this.priorityFromData(t, r.correlationId);
      out.push({
        correlationId: r.correlationId,
        tenantId: t,
        borrower,
        negotiatedAmountCents,
        priority,
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
          SELECT correlationId, toState AS ts,
            ROW_NUMBER() OVER (PARTITION BY correlationId ORDER BY occurredAt DESC, id DESC) rn
          FROM state_transition_log
          WHERE tenantId = ? AND machine = ?
        ) z WHERE rn = 1 AND ts = ?
      )
    `;
    const ids = (await this.transitions.query(sql, [t, t, MachineKind.SYNC, SyncMachineState.COMPLETED])) as Array<{
      correlationId: string;
    }>;
    const result: Awaited<ReturnType<TransitionReadModelService['listActiveExecutions']>> = [];
    for (const { correlationId } of ids) {
      const latestRows = await this.transitions.find({
        where: { tenantId: t, correlationId },
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 20,
      });
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
      const campaignId = await this.campaignIdForCase(t, correlationId);
      result.push({
        correlationId,
        currentPhase: phase,
        currentStateSummary: summary,
        lastUpdatedAt: last.occurredAt.toISOString(),
        campaignId,
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
      SELECT correlationId AS paymentId, toState AS st
      FROM (
        SELECT correlationId, toState,
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
    const out: Awaited<ReturnType<TransitionReadModelService['listPendingPayments']>> = [];
    for (const r of rows) {
      const amountCents = await this.paymentAmountCents(t, r.paymentId);
      out.push({
        correlationId: r.paymentId,
        paymentId: r.paymentId,
        amountCents,
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

    const transitionsForAmount = await this.transitions.find({
      where: { tenantId: t, machine: MachineKind.PAYMENT, toState: PaymentMachineState.SUCCESS },
      select: ['metadataJson'],
    });
    let collectedAmountCents = 0;
    for (const row of transitionsForAmount) {
      const meta = safeJson(row.metadataJson);
      const n = meta?.amountCents;
      if (typeof n === 'number' && Number.isFinite(n)) {
        collectedAmountCents += n;
      }
    }

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

  private async borrowerSnapshot(
    tenantId: string,
    correlationId: string,
  ): Promise<{ name?: string; phone?: string; accountNumber?: string }> {
    const row = await this.ingestionRecords.findOne({ where: { tenantId, correlationId } });
    if (!row) {
      return {};
    }
    try {
      const json = this.pii.openUtf8(row.payloadSealed);
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

  private async negotiatedAmountCents(tenantId: string, correlationId: string): Promise<number | null> {
    const rows = await this.transitions.find({
      where: { tenantId, correlationId, machine: MachineKind.CALL },
      order: { occurredAt: 'DESC' },
      take: 15,
    });
    for (const row of rows) {
      const m = safeJson(row.metadataJson);
      if (!m) {
        continue;
      }
      const v = m.negotiatedAmountCents ?? m.offerAmountCents;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
      }
    }
    return null;
  }

  private async priorityFromData(
    tenantId: string,
    correlationId: string,
  ): Promise<{ score?: number; label?: string } | null> {
    const row = await this.transitions.findOne({
      where: { tenantId, correlationId, machine: MachineKind.DATA },
      order: { occurredAt: 'DESC' },
    });
    const m = safeJson(row?.metadataJson ?? null);
    if (!m) {
      return null;
    }
    const score = typeof m.priorityScore === 'number' ? m.priorityScore : undefined;
    const label = typeof m.priorityLabel === 'string' ? m.priorityLabel : undefined;
    if (score == null && label == null) {
      return null;
    }
    return { score, label };
  }

  private async campaignIdForCase(tenantId: string, correlationId: string): Promise<string | null> {
    const row = await this.ingestionRecords.findOne({ where: { tenantId, correlationId } });
    return row?.campaignId?.trim() || null;
  }

  private async paymentAmountCents(tenantId: string, paymentId: string): Promise<number | null> {
    const row = await this.transitions.findOne({
      where: { tenantId, correlationId: paymentId, machine: MachineKind.PAYMENT },
      order: { occurredAt: 'ASC' },
    });
    const m = safeJson(row?.metadataJson ?? null);
    const v = m?.amountCents;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    return null;
  }
}
