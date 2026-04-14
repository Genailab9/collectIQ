import { MigrationInterface, QueryRunner } from 'typeorm';

export class SaaSTenantProfile1710000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_saas_profile" (
        "tenantId" varchar(128) PRIMARY KEY NOT NULL,
        "displayName" varchar(256) NOT NULL DEFAULT '',
        "plan" varchar(32) NOT NULL DEFAULT 'free',
        "enabled" integer NOT NULL DEFAULT 1,
        "caseCount" integer NOT NULL DEFAULT 0,
        "apiCallCount" integer NOT NULL DEFAULT 0,
        "paymentProcessedCount" integer NOT NULL DEFAULT 0,
        "stripeCustomerId" varchar(256),
        "stripeSubscriptionId" varchar(256),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_saas_profile";`);
  }
}
