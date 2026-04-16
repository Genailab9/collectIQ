import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebhookTenantScopedDedupe1722000000000 implements MigrationInterface {
  name = 'WebhookTenantScopedDedupe1722000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "webhook_events_provider_dedupe"');
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_tenant_dedupe" ON "webhook_events" ("provider", "tenant_id", "external_dedupe_key")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "webhook_events_provider_tenant_dedupe"');
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_dedupe" ON "webhook_events" ("provider", "external_dedupe_key")',
    );
  }
}
