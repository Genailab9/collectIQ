import { Injectable } from '@nestjs/common';
import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import { SyncCommandKind } from '../../contracts/sync-command-kind';
import type { SyncAdapter } from '../interfaces/sync-adapter.interface';

export interface PostPaymentSyncBody {
  readonly tenantId: string;
  readonly paymentId: string;
  readonly approvalCorrelationId: string;
}

/**
 * Idempotent CRM/ledger placeholder (PRD v1.1 §6.3). No side effects beyond structured audit payload.
 */
@Injectable()
export class CollectiqSyncAdapter implements SyncAdapter {
  async execute(envelope: AdapterEnvelope): Promise<unknown> {
    if (envelope.kind !== SyncCommandKind.PostPaymentSync) {
      return { ok: false, reason: 'unsupported_sync_command', kind: envelope.kind };
    }
    const body = envelope.body as Partial<PostPaymentSyncBody>;
    const paymentId = body.paymentId?.trim() ?? '';
    const tenantId = body.tenantId?.trim() ?? '';
    if (!tenantId || !paymentId || !body.approvalCorrelationId?.trim()) {
      return { ok: false, reason: 'invalid_post_payment_sync_body' };
    }
    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      tenantId,
      paymentId,
      approvalCorrelationId: body.approvalCorrelationId.trim(),
    };
  }
}
