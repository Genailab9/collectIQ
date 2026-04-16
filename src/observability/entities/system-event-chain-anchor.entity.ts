import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('system_event_chain_anchor')
@Index('idx_system_event_chain_anchor_tenant_correlation_seq', ['tenantId', 'correlationId', 'anchorSeq'])
export class SystemEventChainAnchorEntity {
  @PrimaryColumn({ type: 'varchar', length: 191 })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 128, name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'integer', name: 'anchor_seq' })
  anchorSeq!: number;

  @Column({ type: 'varchar', length: 64, name: 'root_hash' })
  rootHash!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
