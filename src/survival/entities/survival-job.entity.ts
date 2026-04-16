import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type SurvivalJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead';

@Entity({ name: 'survival_job' })
@Index(['tenantId', 'queue', 'status', 'runAfter'])
export class SurvivalJobEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128, default: 'admin-plane' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  queue!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text' })
  payloadJson!: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: SurvivalJobStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ type: 'text', nullable: true })
  deadLetterReason!: string | null;

  @Column({ type: 'datetime' })
  runAfter!: Date;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
