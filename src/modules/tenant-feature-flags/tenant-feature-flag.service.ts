import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { TenantFeatureFlagEntity } from './tenant-feature-flag.entity';

@Injectable()
export class TenantFeatureFlagService {
  constructor(
    @InjectRepository(TenantFeatureFlagEntity)
    private readonly flags: Repository<TenantFeatureFlagEntity>,
  ) {}

  async list(tenantId: string): Promise<TenantFeatureFlagEntity[]> {
    return this.flags.find({
      where: { tenantId: tenantId.trim() },
      order: { key: 'ASC' },
    });
  }

  async upsert(tenantId: string, key: string, value: unknown): Promise<TenantFeatureFlagEntity> {
    const t = tenantId.trim();
    const k = key.trim();
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new BadRequestException('value must be JSON-serializable.');
    }
    const existing = await this.flags.findOne({ where: { tenantId: t, key: k } });
    if (existing) {
      existing.valueJson = json;
      return this.flags.save(existing);
    }
    const row = this.flags.create({
      id: randomUUID(),
      tenantId: t,
      key: k,
      valueJson: json,
    });
    return this.flags.save(row);
  }

  async getBoolean(tenantId: string, key: string, defaultValue = false): Promise<boolean> {
    const row = await this.flags.findOne({
      where: { tenantId: tenantId.trim(), key: key.trim() },
      select: { valueJson: true },
    });
    if (!row) {
      return defaultValue;
    }
    try {
      const parsed = JSON.parse(row.valueJson) as unknown;
      if (typeof parsed === 'boolean') {
        return parsed;
      }
      if (typeof parsed === 'string') {
        const v = parsed.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'off'].includes(v)) return false;
      }
      if (typeof parsed === 'number') {
        return parsed !== 0;
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  }
}
