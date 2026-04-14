import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type SaaSPlan = 'free' | 'pro' | 'enterprise';

@Entity({ name: 'tenant_saas_profile' })
export class TenantSaaSProfileEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 256, default: '' })
  displayName!: string;

  @Column({ type: 'varchar', length: 32, default: 'free' })
  plan!: SaaSPlan;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'integer', default: 0 })
  caseCount!: number;

  @Column({ type: 'integer', default: 0 })
  apiCallCount!: number;

  @Column({ type: 'integer', default: 0 })
  paymentProcessedCount!: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  stripeCustomerId!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  stripeSubscriptionId!: string | null;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
