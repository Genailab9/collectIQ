import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { WebhookEventEntity } from './entities/webhook-event.entity';

export type WebhookEventBeginResult =
  | { readonly mode: 'created'; readonly event: WebhookEventEntity }
  | { readonly mode: 'duplicate'; readonly event: WebhookEventEntity };

@Injectable()
export class WebhookEventService {
  constructor(
    @InjectRepository(WebhookEventEntity)
    private readonly events: Repository<WebhookEventEntity>,
  ) {}

  /**
   * Persists raw payload after signature verification (caller must run guard first).
   * Deduplicates by (provider, externalDedupeKey) so Twilio retries map to one row.
   */
  async beginIngest(params: {
    provider: string;
    tenantId: string;
    correlationId: string;
    externalDedupeKey: string;
    rawPayload: Record<string, string>;
  }): Promise<WebhookEventBeginResult> {
    const existing = await this.events.findOne({
      where: {
        provider: params.provider,
        tenantId: params.tenantId,
        externalDedupeKey: params.externalDedupeKey,
      },
    });
    if (existing) {
      return { mode: 'duplicate', event: existing };
    }

    const row = this.events.create({
      provider: params.provider,
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      externalDedupeKey: params.externalDedupeKey,
      rawPayload: JSON.stringify(params.rawPayload),
      normalizedEvent: null,
      processed: false,
    });

    try {
      const saved = await this.events.save(row);
      return { mode: 'created', event: saved };
    } catch (e) {
      if (!isUniqueConstraintViolation(e)) {
        throw e;
      }
      const again = await this.events.findOne({
        where: {
          provider: params.provider,
          tenantId: params.tenantId,
          externalDedupeKey: params.externalDedupeKey,
        },
      });
      if (!again) {
        throw e;
      }
      return { mode: 'duplicate', event: again };
    }
  }

  async markProcessed(tenantId: string, eventId: string, normalizedEvent: unknown): Promise<void> {
    await this.events.update(
      { tenantId, id: eventId },
      {
        processed: true,
        normalizedEvent: JSON.stringify(normalizedEvent),
      },
    );
  }
}

function isUniqueConstraintViolation(e: unknown): boolean {
  if (!(e instanceof QueryFailedError)) {
    return false;
  }
  const d = e.driverError as { code?: string; errno?: number } | undefined;
  if (!d) {
    return false;
  }
  return d.code === 'SQLITE_CONSTRAINT' || d.code === '23505' || d.errno === 19;
}
