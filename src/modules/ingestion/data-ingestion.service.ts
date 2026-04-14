import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { PrometheusMetricsService } from '../../observability/prometheus-metrics.service';
import { RateLimiterService } from '../../rate-limit/rate-limiter.service';
import { DataCommandKind } from '../../contracts/data-command-kind';
import { IdempotencyStep } from '../../contracts/idempotency-step';
import { ExecutionLoopPhase } from '../../contracts/execution-loop-phase';
import { requireSmekCompleted } from '../../kernel/smek-loop-result.guard';
import { SmekKernelService } from '../../kernel/smek-kernel.service';
import { DataMachineState } from '../../state-machine/definitions/data-machine.definition';
import { MachineKind } from '../../state-machine/types/machine-kind';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { SaaSUsageService } from '../../saas/saas-usage.service';
import { CampaignService } from '../campaign/campaign.service';
import { IngestionAccountRowDto } from './ingestion-account.dto';

export interface DataIngestionUploadBody {
  readonly idempotency_key: string;
  readonly accounts: readonly unknown[];
  readonly borrower_opted_out?: boolean;
  /** Optional campaign UUID (must exist and be ACTIVE for tenant). Linked on ingestion row + transition metadata. */
  readonly campaign_id?: string;
}

export interface DataIngestionAcceptedRow {
  readonly index: number;
  readonly correlation_id: string;
  readonly record_id: string;
}

export interface DataIngestionRejectedRow {
  readonly index: number;
  readonly reason: string;
}

export interface DataIngestionUploadResult {
  readonly accepted: readonly DataIngestionAcceptedRow[];
  readonly rejected: readonly DataIngestionRejectedRow[];
}

interface ValidatedAccount {
  readonly account_number: string;
  readonly cnic: string;
  readonly phone: string;
  readonly amount: number;
}

/**
 * PRD v1.2 §4 — validate → encrypt PII → persist → SMEK(DATA) per valid row.
 */
@Injectable()
export class DataIngestionService {
  constructor(
    private readonly smekKernel: SmekKernelService,
    private readonly tenantContext: TenantContextService,
    private readonly rateLimiter: RateLimiterService,
    private readonly campaigns: CampaignService,
    @Optional() private readonly saasUsage?: SaaSUsageService,
    @Optional() private readonly metrics?: PrometheusMetricsService,
  ) {}

  async upload(body: DataIngestionUploadBody): Promise<DataIngestionUploadResult> {
    const tenantId = this.tenantContext.getRequired();
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    if (!idempotencyKey) {
      throw new BadRequestException('idempotency_key is required.');
    }
    if (!Array.isArray(body.accounts)) {
      throw new BadRequestException('accounts must be a non-empty array.');
    }
    if (body.accounts.length === 0) {
      throw new BadRequestException('accounts must be a non-empty array.');
    }

    const t0 = Date.now();
    await this.rateLimiter.acquireIngestionRows(tenantId, body.accounts.length);
    if (Date.now() - t0 > 50) {
      try {
        this.metrics?.incIngestionRateLimited();
      } catch {
        // ignore
      }
    }

    let campaignId: string | undefined;
    if (typeof body.campaign_id === 'string' && body.campaign_id.trim().length > 0) {
      const cid = body.campaign_id.trim();
      if (!isUuid(cid)) {
        throw new BadRequestException('campaign_id must be a UUID for an existing campaign.');
      }
      if (this.campaigns) {
        await this.campaigns.assertActiveForTenant(tenantId, cid);
      }
      campaignId = cid;
    }

    const accepted: DataIngestionAcceptedRow[] = [];
    const rejected: DataIngestionRejectedRow[] = [];

    for (let i = 0; i < body.accounts.length; i += 1) {
      const parsed = this.validateAccountRow(body.accounts[i], i);
      if (!parsed.ok) {
        rejected.push({ index: i, reason: parsed.reason });
        continue;
      }

      const correlationId = randomUUID();
      const rowId = `${idempotencyKey}:${i}`;
      const smekIdempotencyKey = `ingestion:${rowId}`;
      const smekResult = requireSmekCompleted(
        await this.smekKernel.executeLoop({
          phase: ExecutionLoopPhase.DATA,
          transition: {
            tenantId,
            correlationId,
            machine: MachineKind.DATA,
            from: DataMachineState.NOT_STARTED,
            to: DataMachineState.COMPLETED,
            actor: 'data-ingestion',
            metadata: {
              source: 'ingestion.upload',
              rowId,
              idempotencyKey: smekIdempotencyKey,
              idempotencyStep: IdempotencyStep.IngestionDataRecordComplete,
              ...(campaignId ? { campaignId } : {}),
            },
          },
          adapterEnvelope: {
            kind: DataCommandKind.IngestionPersist,
            body: {
              tenantId,
              correlationId,
              payload: parsed.value,
              campaignId: campaignId ?? null,
            },
          },
          complianceGate: {
            tenantId,
            correlationId,
            executionPhase: ExecutionLoopPhase.DATA,
            borrowerOptedOut: body.borrower_opted_out === true,
          },
          idempotency: {
            key: smekIdempotencyKey,
            step: IdempotencyStep.IngestionDataRecordComplete,
          },
        }),
        (m) => new BadRequestException(m),
      );
      const adapterResult = smekResult.adapterResult as { recordId?: string } | undefined;
      const recordId = adapterResult?.recordId?.trim() ?? '';
      if (!recordId) {
        throw new BadRequestException('Ingestion persistence failed in SMEK.');
      }

      accepted.push({
        index: i,
        correlation_id: smekResult.correlationId,
        record_id: recordId,
      });
    }

    if (accepted.length > 0 && this.saasUsage) {
      try {
        await this.saasUsage.incrementCases(tenantId, accepted.length);
      } catch {
        // SaaS metering must never block ingestion.
      }
    }

    return { accepted, rejected };
  }

  private validateAccountRow(
    raw: unknown,
    index: number,
  ): { ok: true; value: ValidatedAccount } | { ok: false; reason: string } {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, reason: `accounts[${index}] must be an object.` };
    }
    const o = raw as Record<string, unknown>;
    const displayName =
      readNonEmptyString(o.name) ?? readNonEmptyString(o.account_number) ?? readNonEmptyString(o.accountNumber);
    const dto = plainToInstance(
      IngestionAccountRowDto,
      {
        ...o,
        name: displayName,
        phone: o.phone,
        amount: o.amount,
      },
      { enableImplicitConversion: true },
    );
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      const msg = errors
        .flatMap((e) => (e.constraints ? Object.values(e.constraints) : []))
        .join('; ');
      return { ok: false, reason: `accounts[${index}]: ${msg}` };
    }

    const account_number = readNonEmptyString(o.account_number) ?? dto.name!.trim();
    const cnic = readNonEmptyString(o.cnic);
    const phone = dto.phone.trim();
    const amount = typeof dto.amount === 'number' ? dto.amount : readPositiveFiniteNumber(o.amount);
    if (!cnic) {
      return { ok: false, reason: `accounts[${index}].cnic is required.` };
    }
    if (amount === null || amount <= 0) {
      return { ok: false, reason: `accounts[${index}].amount must be a positive finite number.` };
    }

    return {
      ok: true,
      value: { account_number, cnic, phone, amount },
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function readNonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function readPositiveFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) {
      return null;
    }
    return v;
  }
  if (typeof v === 'string') {
    const n = Number(v.trim());
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    return n;
  }
  return null;
}
