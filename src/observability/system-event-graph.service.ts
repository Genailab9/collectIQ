import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StructuredLogEvent } from './structured-log.types';
import type { IncidentTimelineDto, SystemEventDto, SystemEventPlane } from './system-event.dto';
import { DomainEventsService } from './domain-events.service';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceExecutionService } from './trace-execution.service';

type UnsealedSystemEvent = Omit<SystemEventDto, 'eventHash' | 'schemaVersion'>;

function planeFromStructured(event: StructuredLogEvent): SystemEventPlane {
  if (event.phase === 'POLICY') {
    return 'policy';
  }
  if (event.phase === 'CONTROL_PLANE' || event.result === 'CONTROL_PLANE_EVENT') {
    return 'control';
  }
  return 'execution';
}

function actorFromMessage(message: string | undefined): string | null {
  if (!message) {
    return null;
  }
  const m = /actor=([^\s]+)/.exec(message);
  if (!m?.[1]) {
    return null;
  }
  return m[1].trim() || null;
}

@Injectable()
export class SystemEventGraphService {
  static readonly SYSTEM_EVENT_SCHEMA_VERSION = 1;

  constructor(
    private readonly traces: TraceExecutionService,
    private readonly structured: StructuredLoggerService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  async buildIncidentTimeline(
    tenantId: string,
    correlationId: string,
    limit = 500,
  ): Promise<IncidentTimelineDto> {
    const t = tenantId.trim();
    const c = correlationId.trim();
    const n = Math.min(2000, Math.max(1, limit));
    const out: UnsealedSystemEvent[] = [];

    const summary = await this.traces.traceExecutionSummary(t, c);
    for (const transition of summary.transitions) {
      out.push({
        eventId: `exec-transition:${transition.occurredAt}:${transition.machine}:${transition.from}:${transition.to}`,
        correlationId: c,
        timestamp: transition.occurredAt,
        plane: 'execution',
        type: 'STATE_TRANSITION',
        tenantId: t,
        actorId: transition.actor,
        payload: {
          machine: transition.machine,
          from: transition.from,
          to: transition.to,
          metadataJson: transition.metadataJson,
        },
        metadata: {
          source: 'trace.summary.transitions',
        },
      });
    }

    const domainEventRows = await this.domainEvents.listDomainEvents({
      tenantId: t,
      correlationId: c,
      limit: Math.min(n, 200),
    });
    for (const row of domainEventRows.events) {
      out.push({
        eventId: `domain-event:${row.eventId}`,
        correlationId: c,
        timestamp: row.timestamp,
        plane: 'execution',
        type: row.eventType,
        tenantId: t,
        actorId: null,
        payload: row.payload as Record<string, unknown>,
        metadata: {
          source: 'domain.events',
        },
      });
    }

    const structuredRows = await this.structured.exportRecentStructuredAsync(t, Math.min(1500, n * 3), c);
    for (const row of structuredRows) {
      const ts = row.timestamp ?? row.at;
      if (!ts) {
        continue;
      }
      out.push({
        eventId: `structured:${ts}:${row.phase}:${row.state}:${row.result}`,
        correlationId: c,
        timestamp: ts,
        plane: planeFromStructured(row),
        type: `${row.phase}:${row.state}`,
        tenantId: t,
        actorId: actorFromMessage(row.message),
        payload: {
          phase: row.phase,
          state: row.state,
          adapter: row.adapter,
          result: row.result,
          surface: row.surface ?? null,
          message: row.message ?? null,
        },
        metadata: {
          source: 'structured.logs',
          level: row.level ?? 'info',
        },
      });
    }

    const deduped = new Map<string, SystemEventDto>();
    for (const event of out) {
      const withHash: SystemEventDto = {
        ...event,
        schemaVersion: SystemEventGraphService.SYSTEM_EVENT_SCHEMA_VERSION,
        eventHash: createHash('sha256')
          .update(
            JSON.stringify({
              eventId: event.eventId,
              correlationId: event.correlationId,
              timestamp: event.timestamp,
              plane: event.plane,
              type: event.type,
              tenantId: event.tenantId,
              actorId: event.actorId,
              payload: event.payload,
              metadata: event.metadata,
            }),
          )
          .digest('hex'),
      };
      const key = `${withHash.eventHash}|${withHash.timestamp}|${withHash.type}|${withHash.plane}`;
      if (!deduped.has(key)) {
        deduped.set(key, withHash);
      }
    }
    const events = [...deduped.values()]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(0, n);

    return {
      correlationId: c,
      tenantId: t,
      events,
    };
  }
}
