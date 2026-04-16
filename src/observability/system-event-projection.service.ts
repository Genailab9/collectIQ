import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { SystemEventChainAnchorEntity } from './entities/system-event-chain-anchor.entity';
import { SystemEventIntegritySnapshotEntity } from './entities/system-event-integrity-snapshot.entity';
import { SystemEventProjectionEntity } from './entities/system-event-projection.entity';
import type { IncidentTimelineDto, SystemEventDto } from './system-event.dto';
import { SystemEventGraphService } from './system-event-graph.service';

@Injectable()
export class SystemEventProjectionService {
  private static readonly INTEGRITY_SCHEMA_VERSION = 1;
  private static readonly HASH_ALGO = 'sha256';
  private static readonly ANCHOR_INTERVAL = 50;
  private static readonly MAX_DECISION_EVENTS = 500;
  private static readonly SNAPSHOT_FRESH_MS = 30_000;

  constructor(
    @InjectRepository(SystemEventProjectionEntity)
    private readonly projections: Repository<SystemEventProjectionEntity>,
    @InjectRepository(SystemEventIntegritySnapshotEntity)
    private readonly integritySnapshots: Repository<SystemEventIntegritySnapshotEntity>,
    @InjectRepository(SystemEventChainAnchorEntity)
    private readonly chainAnchors: Repository<SystemEventChainAnchorEntity>,
    private readonly graph: SystemEventGraphService,
    private readonly metrics: PrometheusMetricsService,
  ) {}

  async readIncidentTimeline(
    tenantId: string,
    correlationId: string,
    limit = 500,
  ): Promise<IncidentTimelineDto> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const n = Math.min(2000, Math.max(1, limit));
    const existing = await this.readProjected(t, c, n);
    if (existing.events.length > 0) {
      return existing;
    }
    const fused = await this.graph.buildIncidentTimeline(t, c, n);
    await this.materialize(t, c, fused.events);
    return this.readProjected(t, c, n);
  }

  async materialize(tenantId: string, correlationId: string, events: SystemEventDto[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const t = tenantId.trim();
    const c = correlationId.trim();
    const currentMaxSeq = await this.projections
      .createQueryBuilder('p')
      .select('MAX(p.seq)', 'maxSeq')
      .where('p.tenantId = :tenantId', { tenantId: t })
      .andWhere('p.correlationId = :correlationId', { correlationId: c })
      .getRawOne<{ maxSeq: string | null }>();
    let seq = Number.parseInt(currentMaxSeq?.maxSeq ?? '0', 10) || 0;
    const lastRow = await this.projections.findOne({
      where: { tenantId: t, correlationId: c },
      order: { seq: 'DESC' },
    });
    let prevChainHash = lastRow?.chainHash ?? null;

    const payload = events
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((event) => {
        seq += 1;
        const decisionId = this.extractDecisionId(event);
        const chainHash = createHash('sha256')
          .update(`${prevChainHash ?? ''}:${event.eventHash}`)
          .digest('hex');
        prevChainHash = chainHash;
        return {
          id: `${t}:${c}:${seq}`,
          tenantId: t,
          correlationId: c,
          plane: event.plane,
          eventTs: new Date(event.timestamp),
          seq,
          eventHash: event.eventHash,
          decisionId,
          chainHash,
          schemaVersion: event.schemaVersion,
          eventJson: JSON.stringify({ ...event, seq }),
        };
      });

    await this.projections
      .createQueryBuilder()
      .insert()
      .into(SystemEventProjectionEntity)
      .values(payload)
      .orIgnore()
      .execute();

    const anchors = payload
      .filter((row) => row.seq % SystemEventProjectionService.ANCHOR_INTERVAL === 0 || this.isTerminalEvent(row.eventJson))
      .map((row) => ({
        id: `${t}:${c}:${row.seq}`,
        tenantId: t,
        correlationId: c,
        anchorSeq: row.seq,
        rootHash: row.chainHash,
      }));
    if (anchors.length > 0) {
      await this.chainAnchors
        .createQueryBuilder()
        .insert()
        .into(SystemEventChainAnchorEntity)
        .values(anchors)
        .orIgnore()
        .execute();
      this.metrics.incChainAnchorWritten();
    }

    await this.updateProjectionMetrics(t, c);
    await this.integritySnapshots.save(
      this.integritySnapshots.create({
        id: `${t}:${c}`,
        tenantId: t,
        correlationId: c,
        lastSeq: seq,
        lastChainHash: prevChainHash,
        lastCheckedAt: new Date(),
        schemaVersion: SystemEventProjectionService.INTEGRITY_SCHEMA_VERSION,
        hashAlgo: SystemEventProjectionService.HASH_ALGO,
      }),
    );
  }

  async readProjected(
    tenantId: string,
    correlationId: string,
    limit: number,
    fromSeq = 0,
  ): Promise<IncidentTimelineDto> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const rows = await this.projections
      .createQueryBuilder('p')
      .where('p.tenantId = :tenantId', { tenantId: t })
      .andWhere('p.correlationId = :correlationId', { correlationId: c })
      .andWhere('p.seq > :fromSeq', { fromSeq })
      .orderBy('p.seq', 'ASC')
      .take(limit)
      .getMany();
    const events: SystemEventDto[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.eventJson) as SystemEventDto;
        events.push({ ...parsed, seq: row.seq });
      } catch {
        // ignore malformed projected rows
      }
    }
    return { correlationId: c, tenantId: t, events };
  }

  async readProjectedOnly(
    tenantId: string,
    correlationId: string,
    limit: number,
    fromSeq = 0,
  ): Promise<IncidentTimelineDto> {
    return this.readProjected(tenantId, correlationId, limit, fromSeq);
  }

  async readDecisionTrace(
    tenantId: string,
    decisionId: string,
    limit = 500,
  ): Promise<SystemEventDto[]> {
    const t = tenantId.trim();
    const d = decisionId.trim();
    const n = Math.min(SystemEventProjectionService.MAX_DECISION_EVENTS, Math.max(1, limit));
    const rows = await this.projections
      .createQueryBuilder('p')
      .where('p.tenantId = :tenantId', { tenantId: t })
      .andWhere('p.decisionId = :decisionId', { decisionId: d })
      .orderBy('p.seq', 'ASC')
      .take(n)
      .getMany();
    const out: SystemEventDto[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.eventJson) as SystemEventDto;
        out.push({ ...parsed, seq: row.seq });
      } catch {
        // ignore malformed rows
      }
    }
    return out;
  }

  async validateSequence(tenantId: string, correlationId: string): Promise<boolean> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const rows = await this.projections.find({
      where: { tenantId: t, correlationId: c },
      order: { seq: 'ASC' },
    });
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i]!.seq !== i + 1) {
        this.metrics.incProjectionIntegrityErrors('sequence_gap');
        return false;
      }
    }
    return true;
  }

  async checkIntegrity(tenantId: string, correlationId: string): Promise<{
    status: 'OK' | 'BROKEN';
    gaps: number[];
    duplicates: string[];
    hashMismatch: boolean;
  }> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const cached = await this.readIntegritySnapshot(t, c);
    if (cached) {
      return cached;
    }
    const rows = await this.projections.find({
      where: { tenantId: t, correlationId: c },
      order: { seq: 'ASC' },
    });
    const gaps: number[] = [];
    const duplicates: string[] = [];
    const seenHashes = new Set<string>();
    let hashMismatch = false;
    let chainMismatch = false;
    let prevChainHash = '';
    for (let i = 0; i < rows.length; i += 1) {
      const expectedSeq = i + 1;
      const row = rows[i]!;
      if (row.seq !== expectedSeq) {
        gaps.push(expectedSeq);
      }
      if (seenHashes.has(row.eventHash)) {
        duplicates.push(row.eventHash);
      } else {
        seenHashes.add(row.eventHash);
      }
      try {
        const parsed = JSON.parse(row.eventJson) as SystemEventDto;
        if (parsed.eventHash !== row.eventHash) {
          hashMismatch = true;
        }
        const expectedChain = createHash('sha256')
          .update(`${prevChainHash}:${row.eventHash}`)
          .digest('hex');
        if (row.chainHash && row.chainHash !== expectedChain) {
          chainMismatch = true;
        }
        prevChainHash = row.chainHash ?? expectedChain;
      } catch {
        hashMismatch = true;
      }
    }
    if (gaps.length > 0) {
      this.metrics.incProjectionIntegrityErrors('sequence_gap');
    }
    if (duplicates.length > 0) {
      this.metrics.incProjectionIntegrityErrors('duplicate_hash');
    }
    if (hashMismatch) {
      this.metrics.incProjectionIntegrityErrors('hash_mismatch');
    }
    if (chainMismatch) {
      this.metrics.incProjectionIntegrityErrors('chain_mismatch');
    }
    const snapshot = await this.integritySnapshots.findOne({
      where: { tenantId: t, correlationId: c },
    });
    if (snapshot) {
      snapshot.lastSeq = rows[rows.length - 1]?.seq ?? 0;
      snapshot.lastChainHash = rows[rows.length - 1]?.chainHash ?? null;
      snapshot.lastCheckedAt = new Date();
      snapshot.schemaVersion = SystemEventProjectionService.INTEGRITY_SCHEMA_VERSION;
      snapshot.hashAlgo = SystemEventProjectionService.HASH_ALGO;
      await this.integritySnapshots.save(snapshot);
    } else {
      await this.integritySnapshots.save(
        this.integritySnapshots.create({
          id: `${t}:${c}`,
          tenantId: t,
          correlationId: c,
          lastSeq: rows[rows.length - 1]?.seq ?? 0,
          lastChainHash: rows[rows.length - 1]?.chainHash ?? null,
          lastCheckedAt: new Date(),
          schemaVersion: SystemEventProjectionService.INTEGRITY_SCHEMA_VERSION,
          hashAlgo: SystemEventProjectionService.HASH_ALGO,
        }),
      );
    }
    return {
      status: gaps.length === 0 && duplicates.length === 0 && !hashMismatch && !chainMismatch ? 'OK' : 'BROKEN',
      gaps,
      duplicates,
      hashMismatch,
    };
  }

  async readChainAnchors(tenantId: string, correlationId: string): Promise<{
    correlationId: string;
    tenantId: string;
    checkpoints: Array<{ seq: number; chainHash: string }>;
    rootHash: string | null;
  }> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const rows = await this.chainAnchors.find({
      where: { tenantId: t, correlationId: c },
      order: { anchorSeq: 'ASC' },
    });
    const last = await this.projections.findOne({
      where: { tenantId: t, correlationId: c },
      order: { seq: 'DESC' },
    });
    return {
      correlationId: c,
      tenantId: t,
      checkpoints: rows.map((row) => ({ seq: row.anchorSeq, chainHash: row.rootHash })),
      rootHash: last?.chainHash ?? null,
    };
  }

  private extractDecisionId(event: SystemEventDto): string | null {
    const msg = String((event.payload as Record<string, unknown>)?.message ?? '');
    const m = /decisionId=([a-f0-9-]+)/i.exec(msg);
    if (!m?.[1]) {
      return null;
    }
    return m[1].trim();
  }

  private isTerminalEvent(eventJson: string): boolean {
    try {
      const parsed = JSON.parse(eventJson) as { type?: string; payload?: Record<string, unknown> };
      const type = String(parsed.type ?? '').toUpperCase();
      if (type.includes('SUCCESS') || type.includes('FAILED') || type.includes('DEAD') || type.includes('COMPLETED')) {
        return true;
      }
      const to = String((parsed.payload ?? {}).to ?? '').toUpperCase();
      return to === 'SUCCESS' || to === 'FAILED' || to === 'DEAD' || to === 'COMPLETED';
    } catch {
      return false;
    }
  }

  private async readIntegritySnapshot(
    tenantId: string,
    correlationId: string,
  ): Promise<{ status: 'OK' | 'BROKEN'; gaps: number[]; duplicates: string[]; hashMismatch: boolean } | null> {
    const snap = await this.integritySnapshots.findOne({ where: { tenantId, correlationId } });
    if (!snap?.lastCheckedAt) {
      return null;
    }
    const ageMs = Date.now() - snap.lastCheckedAt.getTime();
    if (ageMs > SystemEventProjectionService.SNAPSHOT_FRESH_MS) {
      return null;
    }
    if (
      snap.schemaVersion !== SystemEventProjectionService.INTEGRITY_SCHEMA_VERSION ||
      snap.hashAlgo !== SystemEventProjectionService.HASH_ALGO
    ) {
      return null;
    }
    return { status: 'OK', gaps: [], duplicates: [], hashMismatch: false };
  }

  private async updateProjectionMetrics(tenantId: string, correlationId: string): Promise<void> {
    const depth = await this.projections.count({ where: { tenantId, correlationId } });
    this.metrics.setProjectionBacklogDepth(depth);
    const latest = await this.projections.findOne({
      where: { tenantId, correlationId },
      order: { seq: 'DESC' },
    });
    if (!latest) {
      this.metrics.setProjectionLagMs(0);
      return;
    }
    const lagMs = Math.max(0, Date.now() - latest.eventTs.getTime());
    this.metrics.setProjectionLagMs(lagMs);
  }
}
