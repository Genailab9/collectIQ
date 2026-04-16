import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_event_integrity_snapshot')
@Index('idx_system_event_integrity_snapshot_tenant_correlation', ['tenantId', 'correlationId'], {
  unique: true,
})
export class SystemEventIntegritySnapshotEntity {
  @PrimaryColumn({ type: 'varchar', length: 191 })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128, name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'integer', name: 'last_seq', default: 0 })
  lastSeq!: number;

  @Column({ type: 'varchar', length: 64, name: 'last_chain_hash', nullable: true })
  lastChainHash!: string | null;

  @Column({ type: 'datetime', name: 'last_checked_at', nullable: true })
  lastCheckedAt!: Date | null;

  @Column({ type: 'integer', name: 'schema_version', default: 1 })
  schemaVersion!: number;

  @Column({ type: 'varchar', length: 16, name: 'hash_algo', default: 'sha256' })
  hashAlgo!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
