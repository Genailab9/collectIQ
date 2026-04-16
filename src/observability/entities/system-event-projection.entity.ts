import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('system_event_projection')
@Unique('uq_system_event_projection_tenant_hash', ['tenantId', 'eventHash'])
@Index('idx_system_event_projection_tenant_correlation_seq', ['tenantId', 'correlationId', 'seq'])
@Index('idx_system_event_projection_tenant_correlation_plane_ts', [
  'tenantId',
  'correlationId',
  'plane',
  'eventTs',
])
@Index('idx_system_event_projection_tenant_decision_seq', ['tenantId', 'decisionId', 'seq'])
export class SystemEventProjectionEntity {
  @PrimaryColumn({ type: 'varchar', length: 191 })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128, name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'varchar', length: 32 })
  plane!: 'execution' | 'control' | 'policy';

  @Column({ type: 'datetime', name: 'event_ts' })
  eventTs!: Date;

  @Column({ type: 'integer' })
  seq!: number;

  @Column({ type: 'varchar', length: 64, name: 'event_hash' })
  eventHash!: string;

  @Column({ type: 'varchar', length: 64, name: 'decision_id', nullable: true })
  decisionId!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'chain_hash', nullable: true })
  chainHash!: string | null;

  @Column({ type: 'integer', name: 'schema_version', default: 1 })
  schemaVersion!: number;

  @Column({ type: 'text', name: 'event_json' })
  eventJson!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
