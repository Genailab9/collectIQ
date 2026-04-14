import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { SmekOrchestrationAuditKind } from '../smek-orchestration-audit.kinds';

@Entity({ name: 'smek_orchestration_audit' })
@Index(['tenantId', 'correlationId', 'createdAt'])
export class SmekOrchestrationAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  kind!: SmekOrchestrationAuditKind;

  @Column({ type: 'text', nullable: false })
  tenantId!: string;

  @Column({ type: 'text' })
  correlationId!: string;

  @Column({ type: 'text' })
  executionPhase!: string;

  @Column({ type: 'text' })
  payloadJson!: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
