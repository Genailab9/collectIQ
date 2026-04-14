import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * PRD §7 — one Stripe PaymentIntent id maps to exactly one CollectIQ payment (never double-bind).
 */
@Entity({ name: 'payment_gateway_intent_links' })
@Index(['tenantId', 'paymentId'], { unique: true })
export class PaymentGatewayIntentLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'text', name: 'payment_id' })
  paymentId!: string;

  @Column({ type: 'text', name: 'gateway_payment_intent_id', unique: true })
  gatewayPaymentIntentId!: string;
}
