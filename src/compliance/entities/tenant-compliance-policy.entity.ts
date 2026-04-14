import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tenant-scoped compliance controls (PRD §5.2). Loaded only for gate.tenantId (strict isolation).
 */
@Entity({ name: 'tenant_compliance_policy' })
export class TenantCompliancePolicyEntity {
  @PrimaryColumn({ type: 'text' })
  tenantId!: string;

  /** Inclusive hour (0–23) in Asia/Karachi (PKT) when engagement may start; must stay within PRD §11.1 (9–20). */
  @Column({ type: 'integer' })
  callWindowStartHourLocal!: number;

  /**
   * Inclusive hour (0–23) in Asia/Karachi (PKT) when engagement may end.
   * Must satisfy `start <= end` and lie within the PRD 9–20 PKT band.
   */
  @Column({ type: 'integer' })
  callWindowEndHourLocal!: number;

  /** Maximum number of CALL-machine transitions that originate from INITIATED for a correlationId. */
  @Column({ type: 'integer' })
  maxCallAttemptsFromInitiated!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;
}
