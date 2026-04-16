import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Speeds observability domain-event listing (tenant + kind + optional domainEventKey prefix).
 */
export class DomainEventsListIndex1721000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_smek_audit_tenant_kind_domain_key"
      ON "smek_orchestration_audit" ("tenantId", "kind", "domainEventKey");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_smek_audit_tenant_kind_domain_key";`);
  }
}
