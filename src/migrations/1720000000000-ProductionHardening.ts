import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Domain event idempotency: stable key column + partial unique index (SQLite).
 * Enables INSERT OR IGNORE for KERNEL_DOMAIN_EVENT without read-then-write races.
 */
export class ProductionHardening1720000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smek_orchestration_audit" ADD COLUMN "domainEventKey" varchar(512);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_smek_audit_domain_event_dedupe"
      ON "smek_orchestration_audit" ("tenantId", "domainEventKey")
      WHERE "domainEventKey" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_smek_audit_domain_event_dedupe";`);
    // SQLite cannot DROP COLUMN reliably across versions — leave column in downgrade.
  }
}
