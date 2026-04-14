import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type IdempotencyRowStatus = 'pending' | 'success' | 'failed';

@Entity({ name: 'idempotency_keys' })
@Index(['tenantId', 'idempotencyKey', 'step'], { unique: true })
export class IdempotencyKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'tenant_id', nullable: false })
  tenantId!: string;

  @Column({ type: 'text', name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'text' })
  step!: string;

  @Column({ type: 'text', name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'text', name: 'response_hash', nullable: true })
  responseHash!: string | null;

  @Column({ type: 'text' })
  status!: IdempotencyRowStatus;

  @Column({ type: 'text', name: 'response_payload_json', nullable: true })
  responsePayloadJson!: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
