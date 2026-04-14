import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type CampaignStatus = 'ACTIVE' | 'ARCHIVED';

@Entity({ name: 'campaign' })
@Index(['tenantId', 'status'])
export class CampaignEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 512 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'ACTIVE' })
  status!: CampaignStatus;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
