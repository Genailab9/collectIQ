import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { TenantSealedCredentialEntity } from './entities/tenant-sealed-credential.entity';

@Injectable()
export class TenantCredentialService {
  constructor(
    @InjectRepository(TenantSealedCredentialEntity)
    private readonly repo: Repository<TenantSealedCredentialEntity>,
    private readonly cipher: AtRestCipherService,
  ) {}

  async upsertSecret(tenantId: string, purpose: string, secretPlain: string): Promise<void> {
    const t = tenantId.trim();
    const p = purpose.trim().slice(0, 64);
    const sealed = this.cipher.sealPayloadJson(JSON.stringify({ v: 1, secret: secretPlain }));
    const existing = await this.repo.findOne({ where: { tenantId: t, purpose: p } });
    if (existing) {
      existing.sealedPayload = sealed;
      existing.rotatedAt = new Date();
      existing.version += 1;
      await this.repo.save(existing);
      return;
    }
    await this.repo.save(
      this.repo.create({
        id: randomUUID(),
        tenantId: t,
        purpose: p,
        sealedPayload: sealed,
        rotatedAt: new Date(),
        version: 1,
      }),
    );
  }

  async readSecret(tenantId: string, purpose: string): Promise<string | null> {
    const row = await this.repo.findOne({
      where: { tenantId: tenantId.trim(), purpose: purpose.trim() },
    });
    if (!row) {
      return null;
    }
    const json = this.cipher.openPayloadJson(row.sealedPayload);
    try {
      const o = JSON.parse(json) as { secret?: string };
      return typeof o.secret === 'string' ? o.secret : null;
    } catch {
      return null;
    }
  }
}
