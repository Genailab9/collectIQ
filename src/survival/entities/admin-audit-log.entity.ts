import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'admin_audit_log' })
@Index(['createdAt'])
export class AdminAuditLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 256 })
  actor!: string;

  @Column({ type: 'varchar', length: 128 })
  action!: string;

  @Column({ type: 'text' })
  detailJson!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
