import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * PRD v1.2 §3.3 — normalized webhook audit trail.
 * `external_dedupe_key` is an implementation extension for stable Twilio (and future) replay deduplication.
 */
@Entity({ name: 'webhook_events' })
@Index('webhook_events_provider_tenant_dedupe', ['provider', 'tenantId', 'externalDedupeKey'], {
  unique: true,
})
export class WebhookEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  provider!: string;

  /** Tenant scope for isolation (operational; query params are not in POST body). */
  @Column({ type: 'text', name: 'tenant_id', nullable: false })
  tenantId!: string;

  @Column({ type: 'text', name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'text', name: 'external_dedupe_key' })
  externalDedupeKey!: string;

  /** Verbatim webhook POST body (JSON). */
  @Column({ type: 'text', name: 'raw_payload' })
  rawPayload!: string;

  /** Canonical intent / outcome JSON after normalization (PRD §3.3). */
  @Column({ type: 'text', name: 'normalized_event', nullable: true })
  normalizedEvent!: string | null;

  @Column({ type: 'boolean', default: false })
  processed!: boolean;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
