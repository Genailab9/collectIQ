import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { SmekLoopCompletedResult, SmekLoopResult } from '../kernel/smek-kernel.dto';
import { SMEK_OUTCOME } from '../kernel/smek-kernel.dto';
import { IdempotencyKeyEntity, type IdempotencyRowStatus } from './entities/idempotency-key.entity';
import { IdempotencyInProgressException } from './idempotency.errors';

export type IdempotencyBeginResult =
  | { readonly mode: 'proceed'; readonly rowId: string }
  | { readonly mode: 'replay'; readonly result: SmekLoopResult };

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKeyEntity)
    private readonly rows: Repository<IdempotencyKeyEntity>,
  ) {}

  /**
   * PRD v1.2 §2 — begin or short-circuit. `correlation_id` is the active SMEK correlation for this loop.
   */
  async checkKey(
    tenantId: string,
    idempotencyKey: string,
    step: string,
    correlationId: string,
  ): Promise<IdempotencyBeginResult> {
    const t = tenantId.trim();
    const k = idempotencyKey.trim();
    const s = step.trim();
    const c = correlationId.trim();
    if (!t || !k || !s || !c) {
      throw new Error('Idempotency check requires tenantId, idempotencyKey, step, and correlationId.');
    }

    const existing = await this.rows.findOne({ where: { tenantId: t, idempotencyKey: k, step: s } });
    if (!existing) {
      const row = this.rows.create({
        tenantId: t,
        idempotencyKey: k,
        step: s,
        correlationId: c,
        status: 'pending',
        responseHash: null,
        responsePayloadJson: null,
      });
      try {
        const saved = await this.rows.save(row);
        return { mode: 'proceed', rowId: saved.id };
      } catch (e) {
        if (!isUniqueConstraintViolation(e)) {
          throw e;
        }
        return this.checkKey(tenantId, idempotencyKey, step, correlationId);
      }
    }

    if (existing.status === 'success') {
      if (!existing.responsePayloadJson) {
        throw new Error('Idempotency row is success but missing response_payload_json.');
      }
      return { mode: 'replay', result: JSON.parse(existing.responsePayloadJson) as SmekLoopResult };
    }

    if (existing.status === 'pending') {
      this.handleInProgress();
    }

    if (existing.status === 'failed') {
      existing.status = 'pending';
      existing.correlationId = c;
      existing.responsePayloadJson = null;
      existing.responseHash = null;
      const saved = await this.rows.save(existing);
      return { mode: 'proceed', rowId: saved.id };
    }

    throw new Error(`Unexpected idempotency row status "${String(existing.status)}".`);
  }

  /** PRD v1.2 §2.4 — persist successful SMEK outcome for replay (COMPLETED only). */
  async storeResult(tenantId: string, rowId: string, result: SmekLoopCompletedResult): Promise<void> {
    if (result.outcome !== SMEK_OUTCOME.COMPLETED) {
      throw new Error('storeResult requires a COMPLETED SMEK outcome.');
    }
    const row = await this.rows.findOne({ where: { tenantId: tenantId.trim(), id: rowId } });
    if (!row) {
      return;
    }
    const payloadJson = JSON.stringify(result);
    row.status = 'success';
    row.responsePayloadJson = payloadJson;
    row.responseHash = this.hashPayload(payloadJson);
    await this.rows.save(row);
  }

  /** Marks row failed so the same key+step may be retried (PRD v1.2 §2.4). */
  async markFailed(tenantId: string, rowId: string): Promise<void> {
    await this.rows.update(
      { tenantId: tenantId.trim(), id: rowId },
      { status: 'failed' satisfies IdempotencyRowStatus },
    );
  }

  handleInProgress(): never {
    throw new IdempotencyInProgressException();
  }

  private hashPayload(payloadJson: string): string {
    return createHash('sha256').update(payloadJson).digest('hex');
  }
}

function isUniqueConstraintViolation(e: unknown): boolean {
  if (!(e instanceof QueryFailedError)) {
    return false;
  }
  const d = e.driverError as { code?: string; errno?: number } | undefined;
  if (!d) {
    return false;
  }
  return d.code === 'SQLITE_CONSTRAINT' || d.code === '23505' || d.errno === 19;
}
