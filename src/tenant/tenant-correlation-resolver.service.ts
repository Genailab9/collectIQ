import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';

export interface ResolveTenantForCorrelationOptions {
  /**
   * When `TWILIO_ACCOUNT_SID_TO_TENANT_JSON` is configured, restricts resolution to this tenant,
   * so the transition-log query always includes `tenant_id` (PRD §15).
   */
  readonly twilioAccountSid?: string;
}

/**
 * PRD v1.2 §5 — resolve authoritative `tenant_id` for a correlation from the transition log
 * (webhooks must not trust `tenantId` query parameters).
 */
@Injectable()
export class TenantCorrelationResolverService {
  constructor(
    @InjectRepository(StateTransitionLogEntity)
    private readonly transitions: Repository<StateTransitionLogEntity>,
    private readonly config: ConfigService,
  ) {}

  async resolveTenantIdForCorrelation(
    correlationId: string,
    options?: ResolveTenantForCorrelationOptions,
  ): Promise<string | null> {
    const c = correlationId.trim();
    if (!c) {
      return null;
    }

    const narrowTenant = this.resolveNarrowTenantFromTwilioAccountSid(options?.twilioAccountSid);

    const qb = this.transitions
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t.tenantId)', 'cnt')
      .addSelect('MIN(t.tenantId)', 'tenantId')
      .where('t.correlationId = :correlationId', { correlationId: c });

    if (narrowTenant) {
      qb.andWhere('t.tenantId = :narrowTenant', { narrowTenant });
    }

    const row = await qb.getRawOne<{ cnt: string; tenantId: string | null }>();
    if (!row?.tenantId) {
      return null;
    }
    const cnt = Number.parseInt(String(row.cnt), 10);
    if (!Number.isFinite(cnt) || cnt !== 1) {
      return null;
    }
    return row.tenantId.trim();
  }

  private resolveNarrowTenantFromTwilioAccountSid(accountSid: string | undefined): string | undefined {
    const sid = accountSid?.trim();
    if (!sid) {
      return undefined;
    }
    const raw = this.config.get<string>('TWILIO_ACCOUNT_SID_TO_TENANT_JSON')?.trim();
    if (!raw) {
      return undefined;
    }
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      const tenantId = map[sid]?.trim();
      return tenantId || undefined;
    } catch {
      return undefined;
    }
  }
}
