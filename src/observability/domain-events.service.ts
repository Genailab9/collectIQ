import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';
import type { DomainEventItemDto, DomainEventsResponseDto, KnownDomainEventType } from './domain-events.dto';

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

@Injectable()
export class DomainEventsService {
  constructor(
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    private readonly cipher: AtRestCipherService,
  ) {}

  /**
   * Reads KERNEL_DOMAIN_EVENT rows only. Tenant + correlationId + optional eventType prefix
   * (`domainEventKey`) are applied in SQL; legacy rows without `domainEventKey` still decrypt-filter.
   * Run `npm run backfill:domain-event-keys` once to populate keys and shrink the legacy path.
   */
  async listDomainEvents(input: {
    tenantId: string;
    correlationId?: string;
    eventType?: KnownDomainEventType;
    limit: number;
  }): Promise<DomainEventsResponseDto> {
    const t = input.tenantId.trim();
    const lim = Math.min(Math.max(input.limit, 1), 200);
    const c = input.correlationId?.trim();
    const qb = this.audits
      .createQueryBuilder('a')
      .where('a.tenantId = :t', { t })
      .andWhere('a.kind = :k', { k: SMEK_ORCHESTRATION_AUDIT_KIND.DomainEvent })
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC');
    if (c) {
      qb.andWhere('a.correlationId = :c', { c });
    }
    if (input.eventType) {
      qb.andWhere('(a.domainEventKey IS NULL OR a.domainEventKey LIKE :pfx)', {
        pfx: `${input.eventType}:%`,
      });
    }
    const fetchCap = input.eventType ? Math.min(lim * 5, 500) : lim;
    qb.take(fetchCap);
    const rows = await qb.getMany();

    const events: DomainEventItemDto[] = [];
    for (const row of rows) {
      if (events.length >= lim) {
        break;
      }
      const plaintext = this.cipher.openPayloadJson(row.payloadJson);
      const decoded = safeJsonParse(plaintext);
      if (!decoded || typeof decoded !== 'object') {
        continue;
      }
      const o = decoded as Record<string, unknown>;
      const eventType = typeof o.eventType === 'string' ? o.eventType : '';
      if (input.eventType && !row.domainEventKey && eventType !== input.eventType) {
        continue;
      }
      const eventId = typeof o.eventId === 'string' ? o.eventId : row.id;
      const inner = o.payload;
      events.push({
        eventId,
        eventType: eventType || 'UNKNOWN',
        correlationId: row.correlationId,
        tenantId: row.tenantId,
        timestamp: row.createdAt.toISOString(),
        payload: inner && typeof inner === 'object' ? inner : decoded,
      });
    }

    return { events };
  }
}
