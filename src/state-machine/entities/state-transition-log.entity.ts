import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'state_transition_log' })
@Index(['tenantId', 'correlationId', 'occurredAt'])
export class StateTransitionLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: false })
  tenantId!: string;

  @Column({ type: 'text' })
  correlationId!: string;

  @Column({ type: 'text' })
  machine!: string;

  @Column({ name: 'from_state', type: 'text' })
  fromState!: string;

  @Column({ name: 'to_state', type: 'text' })
  toState!: string;

  @Column({ type: 'text', nullable: true })
  actor!: string | null;

  @Column({ type: 'text', nullable: true })
  metadataJson!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  occurredAt!: Date;
}
