import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';

@Injectable()
export class AdminAuditLogService {
  constructor(
    @InjectRepository(AdminAuditLogEntity)
    private readonly logs: Repository<AdminAuditLogEntity>,
  ) {}

  async record(input: {
    tenantId?: string | null;
    actor: string;
    action: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const row = this.logs.create({
      id: randomUUID(),
      tenantId: input.tenantId?.trim() || null,
      actor: input.actor.trim().slice(0, 256),
      action: input.action.trim().slice(0, 128),
      detailJson: JSON.stringify(input.detail),
    });
    await this.logs.save(row);
  }
}
