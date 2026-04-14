import { MigrationInterface, QueryRunner } from 'typeorm';

export class PhaseAProduction1712000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "campaign" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "tenantId" varchar(128) NOT NULL,
        "name" varchar(512) NOT NULL,
        "description" text,
        "status" varchar(24) NOT NULL DEFAULT 'ACTIVE',
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_campaign_tenant" ON "campaign" ("tenantId", "status");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_feature_flag" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "tenantId" varchar(128) NOT NULL,
        "key" varchar(128) NOT NULL,
        "valueJson" text NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenant_feature_flag_key" ON "tenant_feature_flag" ("tenantId", "key");`,
    );

    await queryRunner.query(`ALTER TABLE "data_ingestion_records" ADD COLUMN "campaignId" varchar(36);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_feature_flag";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign";`);
    // SQLite cannot drop column easily — leave campaignId column in downgrade for safety.
  }
}
