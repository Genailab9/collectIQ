import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRD §17 — baseline migration (no-op). Production must use additive, backward-compatible DDL only
 * (new nullable columns, new tables/indexes). Avoid destructive renames/drops until rolled out.
 */
export class DeploymentSafetyBaseline1700000000000 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {
    // Dev schema may still use synchronize; first real migrations should mirror additive changes only.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally empty — baseline no-op.
  }
}
