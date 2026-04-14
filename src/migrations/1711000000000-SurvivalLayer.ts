import { MigrationInterface, QueryRunner } from 'typeorm';

export class SurvivalLayer1711000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_outbox" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "tenantId" varchar(128) NOT NULL,
        "channel" varchar(32) NOT NULL,
        "dedupeKey" varchar(512) NOT NULL,
        "payloadJson" text NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 8,
        "nextRetryAt" datetime,
        "lastError" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_outbox_tenant_dedupe" ON "notification_outbox" ("tenantId", "dedupeKey");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_outbox_poll" ON "notification_outbox" ("status", "nextRetryAt");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_feed" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "tenantId" varchar(128) NOT NULL,
        "correlationId" varchar(128) NOT NULL,
        "title" varchar(512) NOT NULL,
        "body" text NOT NULL,
        "severity" varchar(32) NOT NULL DEFAULT 'info',
        "metadataJson" text,
        "readAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_feed_tenant_created" ON "notification_feed" ("tenantId", "createdAt");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "survival_job" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "queue" varchar(64) NOT NULL,
        "name" varchar(128) NOT NULL,
        "payloadJson" text NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 5,
        "deadLetterReason" text,
        "runAfter" datetime NOT NULL DEFAULT (datetime('now')),
        "lastError" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_survival_job_poll" ON "survival_job" ("queue", "status", "runAfter");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_log" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "tenantId" varchar(128),
        "actor" varchar(256) NOT NULL,
        "action" varchar(128) NOT NULL,
        "detailJson" text NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_created" ON "admin_audit_log" ("createdAt");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_sealed_credential" (
        "id" varchar(36) PRIMARY KEY NOT NULL,
        "tenantId" varchar(128) NOT NULL,
        "purpose" varchar(64) NOT NULL,
        "sealedPayload" text NOT NULL,
        "rotatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        "version" integer NOT NULL DEFAULT 1
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenant_sealed_purpose" ON "tenant_sealed_credential" ("tenantId", "purpose");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_sealed_credential";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_audit_log";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "survival_job";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_feed";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_outbox";`);
  }
}
