import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import { DataCommandKind } from '../../contracts/data-command-kind';
import type { DataExecutionPort } from '../../contracts/data-execution.port';
import { PiiEncryptionService } from '../../security/pii-encryption.service';
import { DataIngestionRecordEntity } from '../../modules/ingestion/entities/data-ingestion-record.entity';

@Injectable()
export class DataExecutionBridge implements DataExecutionPort {
  constructor(
    @InjectRepository(DataIngestionRecordEntity)
    private readonly records: Repository<DataIngestionRecordEntity>,
    private readonly pii: PiiEncryptionService,
  ) {}

  async execute(envelope: AdapterEnvelope): Promise<unknown> {
    if (envelope.kind !== DataCommandKind.IngestionPersist) {
      return { ok: false, reason: 'unsupported_data_command', kind: envelope.kind };
    }
    const body = envelope.body as {
      tenantId: string;
      correlationId: string;
      payload: unknown;
      campaignId?: string | null;
    };
    const tenantId = body.tenantId?.trim() ?? '';
    const correlationId = body.correlationId?.trim() ?? '';
    if (!tenantId || !correlationId) {
      return { ok: false, reason: 'invalid_ingestion_persist_body' };
    }
    const payloadSealed = this.pii.sealUtf8(JSON.stringify(body.payload ?? {}));
    const campaignId =
      typeof body.campaignId === 'string' && body.campaignId.trim().length > 0
        ? body.campaignId.trim()
        : null;
    const row = this.records.create({ tenantId, correlationId, payloadSealed, campaignId });
    const saved = await this.records.save(row);
    return { ok: true, recordId: saved.id };
  }
}
