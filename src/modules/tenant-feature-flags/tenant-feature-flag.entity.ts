import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'tenant_feature_flag' })
@Index(['tenantId', 'key'], { unique: true })
export class TenantFeatureFlagEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  /** JSON-encoded boolean, string, or object. */
  @Column({ type: 'text' })
  valueJson!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
