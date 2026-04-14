import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * At-rest sealed blob (AES-GCM via {@link AtRestCipherService}) for rotation-friendly secrets.
 */
@Entity({ name: 'tenant_sealed_credential' })
@Index(['tenantId', 'purpose'], { unique: true })
export class TenantSealedCredentialEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  purpose!: string;

  @Column({ type: 'text' })
  sealedPayload!: string;

  @Column({ type: 'datetime' })
  rotatedAt!: Date;

  @Column({ type: 'integer', default: 1 })
  version!: number;
}
