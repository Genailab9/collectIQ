/**
 * One-off: populate `domainEventKey` on legacy KERNEL_DOMAIN_EVENT rows so SQL filters + unique dedupe apply.
 *
 * Run from `backend/` (requires same env as the API, especially `COLLECTIQ_DATA_KEY` when payloads are encrypted):
 *   npm run backfill:domain-event-keys
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AtRestCipherService } from '../data-lifecycle/at-rest-cipher.service';
import { SmekOrchestrationAuditEntity } from '../kernel/entities/smek-orchestration-audit.entity';
import { SMEK_ORCHESTRATION_AUDIT_KIND } from '../kernel/smek-orchestration-audit.kinds';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;
  try {
    const ds = app.get(DataSource);
    const cipher = app.get(AtRestCipherService);
    const repo = ds.getRepository(SmekOrchestrationAuditEntity);

    const rows = await repo
      .createQueryBuilder('a')
      .where('a.kind = :k', { k: SMEK_ORCHESTRATION_AUDIT_KIND.DomainEvent })
      .andWhere('(a.domainEventKey IS NULL OR a.domainEventKey = :empty)', { empty: '' })
      .orderBy('a.createdAt', 'ASC')
      .getMany();

    for (const row of rows) {
      const plaintext = cipher.openPayloadJson(row.payloadJson);
      let parsed: unknown;
      try {
        parsed = JSON.parse(plaintext) as unknown;
      } catch {
        skipped += 1;
        continue;
      }
      if (!parsed || typeof parsed !== 'object') {
        skipped += 1;
        continue;
      }
      const o = parsed as Record<string, unknown>;
      const eventType = typeof o.eventType === 'string' ? o.eventType.trim() : '';
      const tenantId = row.tenantId.trim();
      const correlationId =
        (typeof o.correlationId === 'string' && o.correlationId.trim()) || row.correlationId.trim();
      const fromPayload =
        typeof o.eventId === 'string' && o.eventId.trim().length > 0
          ? o.eventId.trim()
          : eventType && correlationId
            ? `${eventType}:${tenantId}:${correlationId}`
            : '';
      if (!fromPayload || fromPayload.length > 512) {
        skipped += 1;
        continue;
      }
      try {
        const r = await repo.update({ id: row.id }, { domainEventKey: fromPayload });
        if ((r.affected ?? 0) > 0) {
          updated += 1;
        } else {
          skipped += 1;
        }
      } catch {
        conflicts += 1;
      }
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        scanned: rows.length,
        updated,
        skipped,
        conflicts,
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
