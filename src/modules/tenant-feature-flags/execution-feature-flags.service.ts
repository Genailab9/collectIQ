import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantFeatureFlagEntity } from './tenant-feature-flag.entity';

export type ExecutionFeatureFlagKey =
  | 'DEMO_MODE'
  | 'SIMULATE_CALLS'
  | 'FORCE_PAYMENT_SUCCESS'
  | 'SIMULATE_PAYMENT_FAILURE'
  | 'SIMULATE_APPROVAL_TIMEOUT'
  | 'SIMULATE_CALL_FAILURE';

type CacheEntry = { expiresAt: number; value: unknown | undefined };

/**
 * Reads tenant-scoped execution flags without requiring HTTP context.
 * Used by SMEK / compliance; short TTL avoids hot-path DB chatter.
 */
@Injectable()
export class ExecutionFeatureFlagsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 2500;

  constructor(
    @InjectRepository(TenantFeatureFlagEntity)
    private readonly flags: Repository<TenantFeatureFlagEntity>,
  ) {}

  async getParsedValue(tenantId: string, key: string): Promise<unknown | undefined> {
    const t = tenantId.trim();
    const k = key.trim();
    if (!t || !k) {
      return undefined;
    }
    const ck = `${t}::${k}`;
    const now = Date.now();
    const hit = this.cache.get(ck);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }
    const row = await this.flags.findOne({ where: { tenantId: t, key: k } });
    let value: unknown | undefined;
    if (row) {
      try {
        value = JSON.parse(row.valueJson) as unknown;
      } catch {
        value = row.valueJson;
      }
    } else {
      value = undefined;
    }
    this.cache.set(ck, { expiresAt: now + this.ttlMs, value });
    return value;
  }

  async isJsonTruthy(tenantId: string, key: ExecutionFeatureFlagKey): Promise<boolean> {
    const v = await this.getParsedValue(tenantId, key);
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  invalidateTenant(tenantId: string): void {
    const prefix = `${tenantId.trim()}::`;
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
      }
    }
  }
}
