import { Injectable } from '@nestjs/common';
import { AtRestCipherService } from '../../data-lifecycle/at-rest-cipher.service';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../../kernel/smek-orchestration-audit.kinds';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { SmekOrchestrationAuditEntity } from '../../kernel/entities/smek-orchestration-audit.entity';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { PaymentMachineState } from '../../state-machine/definitions/payment-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';

@Injectable()
export class PaymentTransitionQueryService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    @InjectRepository(SmekOrchestrationAuditEntity)
    private readonly audits: Repository<SmekOrchestrationAuditEntity>,
    private readonly atRestCipher: AtRestCipherService,
  ) {}

  /**
   * Latest PAYMENT machine `toState` for a paymentId (stored as transition correlationId).
   */
  async getLatestPaymentToState(tenantId: string, paymentId: string): Promise<string | null> {
    const row = await this.transitions
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.correlationId = :paymentId', { paymentId })
      .andWhere('t.machine = :machine', { machine: MachineKind.PAYMENT })
      .orderBy('t.occurredAt', 'DESC')
      .getOne();
    return row?.toState ?? null;
  }

  /**
   * First PAYMENT bootstrap row for idempotent replay (metadata carries idempotencyKey).
   */
  async findPaymentIdByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<string | null> {
    const row = await this.transitions
      .createQueryBuilder('t')
      .select('t.correlationId', 'correlationId')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.machine = :machine', { machine: MachineKind.PAYMENT })
      .andWhere("json_extract(t.metadataJson, '$.idempotencyKey') = :ik", { ik: idempotencyKey })
      .orderBy('t.occurredAt', 'ASC')
      .getRawOne<{ correlationId: string }>();
    return row?.correlationId ?? null;
  }

  /**
   * Reads latest PAY-phase adapter result from SMEK audit (operational bridge until gateway id is mirrored on transitions).
   */
  async getBootstrapMetadataForPayment(
    tenantId: string,
    paymentId: string,
  ): Promise<{
    idempotencyKey: string;
    amountCents: number;
    currency: string;
    approvalCorrelationId: string;
  } | null> {
    const row = await this.transitions
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.correlationId = :paymentId', { paymentId })
      .andWhere('t.machine = :machine', { machine: MachineKind.PAYMENT })
      .andWhere('t.fromState = :from', { from: PaymentMachineState.ALTERNATE_METHOD })
      .andWhere('t.toState = :to', { to: PaymentMachineState.INITIATED })
      .orderBy('t.occurredAt', 'ASC')
      .getOne();
    if (!row?.metadataJson) {
      return null;
    }
    try {
      const m = JSON.parse(row.metadataJson) as {
        idempotencyKey?: string;
        amountCents?: number;
        currency?: string;
        approvalCorrelationId?: string;
      };
      if (
        m.idempotencyKey == null ||
        m.amountCents == null ||
        m.currency == null ||
        m.approvalCorrelationId == null
      ) {
        return null;
      }
      return {
        idempotencyKey: m.idempotencyKey,
        amountCents: m.amountCents,
        currency: m.currency,
        approvalCorrelationId: m.approvalCorrelationId,
      };
    } catch {
      return null;
    }
  }

  async getLatestGatewayPaymentIntentId(tenantId: string, paymentId: string): Promise<string | null> {
    const row = await this.audits
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.correlationId = :paymentId', { paymentId })
      .andWhere('a.kind = :kind', { kind: SMEK_ORCHESTRATION_AUDIT_KIND.AdapterResult })
      .andWhere('a.executionPhase = :phase', { phase: ExecutionLoopPhase.PAY })
      .orderBy('a.createdAt', 'DESC')
      .getOne();
    if (!row) {
      return null;
    }
    try {
      const payload = JSON.parse(this.atRestCipher.openPayloadJson(row.payloadJson)) as {
        adapterResult?: { gatewayPaymentIntentId?: string };
      };
      return payload.adapterResult?.gatewayPaymentIntentId ?? null;
    } catch {
      return null;
    }
  }
}
