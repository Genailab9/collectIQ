import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { TwilioWebhookService } from '../../adapters/telephony/webhooks/twilio-webhook.service';
import { WebhookEventEntity } from '../../adapters/telephony/webhooks/entities/webhook-event.entity';
import { SmekOrchestrationAuditEntity } from '../../kernel/entities/smek-orchestration-audit.entity';
import { IdempotencyKeyEntity } from '../../idempotency/entities/idempotency-key.entity';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { CampaignEntity } from '../campaign/campaign.entity';
import { CampaignService } from '../campaign/campaign.service';
import { DataIngestionService } from '../ingestion/data-ingestion.service';
import { DataIngestionRecordEntity } from '../ingestion/entities/data-ingestion-record.entity';
import { ApprovalService } from '../approval/approval.service';
import { PaymentService } from '../payment/payment.service';
import { PaymentGatewayIntentLinkEntity } from '../payment/entities/payment-gateway-intent-link.entity';
import { SettlementExecutionService } from '../settlement-execution/settlement-execution.service';
import { SyncCaseSnapshotEntity } from '../sync/entities/sync-case-snapshot.entity';
import { ExecutionFeatureFlagsService } from '../tenant-feature-flags/execution-feature-flags.service';
import { TenantFeatureFlagEntity } from '../tenant-feature-flags/tenant-feature-flag.entity';
import { DEMO_SEED_MANIFEST_KEY, type DemoSeedManifestV1 } from './demo.constants';

@Injectable()
export class DemoService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly executionFlags: ExecutionFeatureFlagsService,
    private readonly campaigns: CampaignService,
    private readonly ingestion: DataIngestionService,
    private readonly twilioRecovery: TwilioWebhookService,
    private readonly settlement: SettlementExecutionService,
    private readonly approvals: ApprovalService,
    private readonly payments: PaymentService,
    @InjectRepository(TenantFeatureFlagEntity)
    private readonly flagRows: Repository<TenantFeatureFlagEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async seed(): Promise<{
    campaignId: string;
    approvalCorrelationIds: readonly string[];
    paymentIds: readonly string[];
  }> {
    const tenantId = this.tenantContext.getRequired().trim();
    await this.assertDemoFlagsForSeed(tenantId);

    const campaign = await this.campaigns.create(tenantId, {
      name: `CollectIQ demo ${new Date().toISOString().slice(0, 19)}Z`,
      description: 'Seeded via POST /demo/seed',
    });

    const accounts = Array.from({ length: 20 }, (_, i) => ({
      name: `Demo Borrower ${i + 1}`,
      account_number: `DEMO-ACC-${i + 1}`,
      cnic: `42201-1234567-${String(i + 1).padStart(2, '0')}`,
      phone: `+1555000${String(i).padStart(5, '0')}`,
      amount: 5000 + i * 100,
    }));

    const upload = await this.ingestion.upload({
      idempotency_key: `demo-seed:${randomUUID()}`,
      accounts,
      campaign_id: campaign.id,
      borrower_opted_out: false,
    });
    if (upload.rejected.length > 0) {
      throw new BadRequestException(
        `Demo ingestion rejected rows: ${upload.rejected.map((r) => `${r.index}:${r.reason}`).join('; ')}`,
      );
    }

    const approvalCorrelationIds = upload.accepted.map((a) => a.correlation_id);
    const paymentIds: string[] = [];

    for (let idx = 0; idx < approvalCorrelationIds.length; idx += 1) {
      const cid = approvalCorrelationIds[idx]!;
      await this.advanceCallToWaitingApproval(tenantId, cid);

      if (idx === 0) {
        const reg = await this.approvals.registerSettlementApprovalRequest({
          tenantId,
          correlationId: cid,
          offerAmountCents: 5_000_000,
          idempotencyKey: `demo:${cid}:appr:${randomUUID()}`,
          borrowerOptedOut: false,
        });
        if (reg.toState !== 'APPROVED') {
          throw new BadRequestException(`Golden case expected APPROVED, got ${reg.toState}`);
        }
        const pi = await this.payments.createPaymentIntent({
          tenantId,
          idempotencyKey: `demo:${cid}:pi:${randomUUID()}`,
          amountCents: 250_000,
          approvalCorrelationId: cid,
          currency: 'usd',
          borrowerOptedOut: false,
        });
        paymentIds.push(pi.paymentId);
        await this.payments.confirmPayment({
          tenantId,
          paymentId: pi.paymentId,
          gatewayPaymentIntentId: pi.gatewayPaymentIntentId,
          idempotencyKey: `demo:${cid}:pc:${randomUUID()}`,
          borrowerOptedOut: false,
        });
      } else if (idx >= 1 && idx <= 6) {
        await this.approvals.registerSettlementApprovalRequest({
          tenantId,
          correlationId: cid,
          offerAmountCents: 55_000_000,
          idempotencyKey: `demo:${cid}:appr:${randomUUID()}`,
          borrowerOptedOut: false,
        });
      } else if (idx >= 7 && idx <= 12) {
        await this.approvals.registerSettlementApprovalRequest({
          tenantId,
          correlationId: cid,
          offerAmountCents: 2_000_000,
          idempotencyKey: `demo:${cid}:appr:${randomUUID()}`,
          borrowerOptedOut: false,
        });
        const pi = await this.payments.createPaymentIntent({
          tenantId,
          idempotencyKey: `demo:${cid}:pi:${randomUUID()}`,
          amountCents: 200_000,
          approvalCorrelationId: cid,
          currency: 'usd',
          borrowerOptedOut: false,
        });
        paymentIds.push(pi.paymentId);
      } else {
        await this.approvals.registerSettlementApprovalRequest({
          tenantId,
          correlationId: cid,
          offerAmountCents: 3_000_000,
          idempotencyKey: `demo:${cid}:appr:${randomUUID()}`,
          borrowerOptedOut: false,
        });
        const pi = await this.payments.createPaymentIntent({
          tenantId,
          idempotencyKey: `demo:${cid}:pi:${randomUUID()}`,
          amountCents: 300_000,
          approvalCorrelationId: cid,
          currency: 'usd',
          borrowerOptedOut: false,
        });
        paymentIds.push(pi.paymentId);
        await this.payments.confirmPayment({
          tenantId,
          paymentId: pi.paymentId,
          gatewayPaymentIntentId: pi.gatewayPaymentIntentId,
          idempotencyKey: `demo:${cid}:pc:${randomUUID()}`,
          borrowerOptedOut: false,
        });
      }
    }

    const manifest: DemoSeedManifestV1 = {
      version: 1,
      campaignId: campaign.id,
      approvalCorrelationIds,
      paymentIds,
    };
    await this.persistManifest(tenantId, manifest);
    this.executionFlags.invalidateTenant(tenantId);
    return { campaignId: campaign.id, approvalCorrelationIds, paymentIds };
  }

  async reset(): Promise<{ deletedCorrelationIds: number }> {
    const tenantId = this.tenantContext.getRequired().trim();
    if (!(await this.executionFlags.isJsonTruthy(tenantId, 'DEMO_MODE'))) {
      throw new BadRequestException('DEMO_MODE must be enabled to reset demo data.');
    }
    const manifest = await this.loadManifest(tenantId);
    if (!manifest) {
      throw new NotFoundException('No demo seed manifest found for this tenant.');
    }

    const allIds = Array.from(new Set([...manifest.approvalCorrelationIds, ...manifest.paymentIds]));
    const t = tenantId;

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(SmekOrchestrationAuditEntity).delete({ tenantId: t, correlationId: In(allIds) });
      await em.getRepository(WebhookEventEntity).delete({ tenantId: t, correlationId: In(allIds) });
      await em.getRepository(IdempotencyKeyEntity).delete({ tenantId: t, correlationId: In(allIds) });
      if (manifest.paymentIds.length > 0) {
        await em
          .getRepository(PaymentGatewayIntentLinkEntity)
          .delete({ tenantId: t, paymentId: In([...manifest.paymentIds]) });
        await em.getRepository(SyncCaseSnapshotEntity).delete({ tenantId: t, paymentId: In([...manifest.paymentIds]) });
      }
      await em.getRepository(StateTransitionLogEntity).delete({ tenantId: t, correlationId: In(allIds) });
      await em
        .getRepository(DataIngestionRecordEntity)
        .delete({ tenantId: t, correlationId: In([...manifest.approvalCorrelationIds]) });
      await em.getRepository(CampaignEntity).delete({ id: manifest.campaignId, tenantId: t });
      await em.getRepository(TenantFeatureFlagEntity).delete({ tenantId: t, key: DEMO_SEED_MANIFEST_KEY });
    });

    this.executionFlags.invalidateTenant(tenantId);
    return { deletedCorrelationIds: allIds.length };
  }

  private async assertDemoFlagsForSeed(tenantId: string): Promise<void> {
    const demo = await this.executionFlags.isJsonTruthy(tenantId, 'DEMO_MODE');
    const sim = await this.executionFlags.isJsonTruthy(tenantId, 'SIMULATE_CALLS');
    const force = await this.executionFlags.isJsonTruthy(tenantId, 'FORCE_PAYMENT_SUCCESS');
    if (!demo || !sim || !force) {
      throw new BadRequestException(
        'Enable tenant flags DEMO_MODE, SIMULATE_CALLS, and FORCE_PAYMENT_SUCCESS before seeding (POST /feature-flags).',
      );
    }
  }

  private async advanceCallToWaitingApproval(tenantId: string, correlationId: string): Promise<void> {
    const ring = await this.twilioRecovery.executeRecoveryVoiceStatus({
      tenantId,
      correlationId,
      providerCallStatus: 'ringing',
      idempotencyKey: `demo:${correlationId}:ring:${randomUUID()}`,
    });
    if (ring.kind === 'compliance_blocked') {
      throw new BadRequestException(`Demo call ringing blocked: ${ring.result.message}`);
    }
    const prog = await this.twilioRecovery.executeRecoveryVoiceStatus({
      tenantId,
      correlationId,
      providerCallStatus: 'in-progress',
      idempotencyKey: `demo:${correlationId}:prog:${randomUUID()}`,
    });
    if (prog.kind === 'compliance_blocked') {
      throw new BadRequestException(`Demo call in-progress blocked: ${prog.result.message}`);
    }

    await this.settlement.authenticateCall({
      tenantId,
      correlationId,
      idempotencyKey: `demo:${correlationId}:auth:${randomUUID()}`,
      borrowerOptedOut: false,
    });
    await this.settlement.negotiate({
      tenantId,
      correlationId,
      conversationTranscript: 'Demo transcript: borrower agrees to review settlement options.',
      accountFacts: 'demo_seed',
      idempotencyKey: `demo:${correlationId}:neg:${randomUUID()}`,
      borrowerOptedOut: false,
    });
    await this.settlement.submitCallForApproval({
      tenantId,
      correlationId,
      idempotencyKey: `demo:${correlationId}:sub:${randomUUID()}`,
      borrowerOptedOut: false,
    });
  }

  private async persistManifest(tenantId: string, manifest: DemoSeedManifestV1): Promise<void> {
    const existing = await this.flagRows.findOne({ where: { tenantId, key: DEMO_SEED_MANIFEST_KEY } });
    const json = JSON.stringify(manifest);
    if (existing) {
      existing.valueJson = json;
      await this.flagRows.save(existing);
      return;
    }
    await this.flagRows.save(
      this.flagRows.create({
        id: randomUUID(),
        tenantId,
        key: DEMO_SEED_MANIFEST_KEY,
        valueJson: json,
      }),
    );
  }

  private async loadManifest(tenantId: string): Promise<DemoSeedManifestV1 | null> {
    const row = await this.flagRows.findOne({ where: { tenantId, key: DEMO_SEED_MANIFEST_KEY } });
    if (!row) {
      return null;
    }
    try {
      const parsed = JSON.parse(row.valueJson) as DemoSeedManifestV1;
      if (parsed?.version !== 1 || !Array.isArray(parsed.approvalCorrelationIds)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
