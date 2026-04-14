import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Immutable-ish settlement sync snapshot after outbound adapter (strict sync loop).
 */
@Entity({ name: 'sync_case_snapshots' })
@Index(['tenantId', 'paymentId'], { unique: true })
export class SyncCaseSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'tenant_id', nullable: false })
  tenantId!: string;

  @Column({ type: 'text', name: 'payment_id' })
  paymentId!: string;

  /** JSON: adapter summary + case identifiers (operational replay). */
  @Column({ type: 'text', name: 'snapshot_json' })
  snapshotJson!: string;

  @Column({ type: 'boolean', name: 'sync_completed_logged', default: false })
  syncCompletedLogged!: boolean;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
