import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * PRD v1.2 §4 — persisted encrypted row before SMEK(DATA).
 * PII lives only in `payload_sealed` (AES-256-GCM via `PiiEncryptionService`: `COLLECTIQ_PII_KEY` or `COLLECTIQ_DATA_KEY`).
 */
@Entity({ name: 'data_ingestion_records' })
@Index(['tenantId', 'correlationId'])
export class DataIngestionRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'tenant_id', nullable: false })
  tenantId!: string;

  @Column({ type: 'text', name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'text', name: 'payload_sealed' })
  payloadSealed!: string;

  @Column({ type: 'varchar', length: 36, name: 'campaignId', nullable: true })
  campaignId!: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
