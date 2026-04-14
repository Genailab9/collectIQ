import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'notification_feed' })
@Index(['tenantId', 'createdAt'])
export class NotificationFeedEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128 })
  correlationId!: string;

  @Column({ type: 'varchar', length: 512 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 32, default: 'info' })
  severity!: string;

  @Column({ type: 'text', nullable: true })
  metadataJson!: string | null;

  @Column({ type: 'datetime', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
