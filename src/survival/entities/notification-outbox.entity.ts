import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type NotificationOutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'dead';

@Entity({ name: 'notification_outbox' })
@Index(['status', 'nextRetryAt'])
export class NotificationOutboxEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tenantId!: string;

  /** internal | email | webhook */
  @Column({ type: 'varchar', length: 32 })
  channel!: string;

  @Column({ type: 'varchar', length: 512 })
  dedupeKey!: string;

  @Column({ type: 'text' })
  payloadJson!: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: NotificationOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'integer', default: 8 })
  maxAttempts!: number;

  @Column({ type: 'datetime', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
