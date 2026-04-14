import { Injectable, Logger } from '@nestjs/common';
import type { StructuredLogEvent } from './structured-log.types';

const RING_MAX = 2000;

/**
 * PRD §12 — JSON-per-line structured logging for operations and compliance review.
 */
@Injectable()
export class StructuredLoggerService {
  private readonly nest = new Logger(StructuredLoggerService.name);
  private readonly ring: StructuredLogEvent[] = [];

  emit(event: StructuredLogEvent): void {
    const line: Record<string, unknown> = {
      correlationId: event.correlationId,
      tenantId: event.tenantId,
      phase: event.phase,
      state: event.state,
      adapter: event.adapter,
      result: event.result,
    };
    if (event.surface !== undefined) {
      line.surface = event.surface;
    }
    if (event.message !== undefined) {
      line.message = event.message;
    }
    if (event.attempt !== undefined) {
      line.attempt = event.attempt;
    }
    if (event.maxAttempts !== undefined) {
      line.maxAttempts = event.maxAttempts;
    }
    if (event.circuitKey !== undefined) {
      line.circuitKey = event.circuitKey;
    }
    this.nest.log(JSON.stringify(line));
    this.ring.push(event);
    if (this.ring.length > RING_MAX) {
      this.ring.splice(0, this.ring.length - RING_MAX);
    }
  }

  /** Phase 4 — bounded in-memory export for incident response (single-process). */
  exportRecentStructured(limit = 500): StructuredLogEvent[] {
    const n = Math.min(RING_MAX, Math.max(1, limit));
    return this.ring.slice(-n);
  }
}
