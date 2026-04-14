import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tenant-scoped approval banding and escalation timeouts.
 * The policy engine is the only component that may classify offers for auto vs manual routing.
 */
@Entity({ name: 'tenant_approval_policy' })
export class TenantApprovalPolicyEntity {
  @PrimaryColumn({ type: 'text' })
  tenantId!: string;

  /** Inclusive lower bound (cents) for auto-approval when offer is within band. */
  @Column({ type: 'integer' })
  bandLowCents!: number;

  /** Inclusive upper bound (cents) for auto-approval when offer is within band. */
  @Column({ type: 'integer' })
  bandHighCents!: number;

  /** Optional hard floor; offers below are rejected as invalid (not silently manual-routed). */
  @Column({ type: 'integer', nullable: true })
  minOfferCents!: number | null;

  /** Optional hard ceiling; offers above are rejected as invalid. */
  @Column({ type: 'integer', nullable: true })
  maxOfferCents!: number | null;

  /** After entering PENDING, escalate if no officer action before this many seconds elapse. */
  @Column({ type: 'integer' })
  pendingTimeoutSeconds!: number;
}
