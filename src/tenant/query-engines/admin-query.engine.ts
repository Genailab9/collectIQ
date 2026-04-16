import { Injectable } from '@nestjs/common';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { CrossTenantScopeReason, TenantQueryScopeService } from '../tenant-query-scope.service';

@Injectable()
export class AdminQueryEngine {
  constructor(private readonly tenantQueryScope: TenantQueryScopeService) {}

  async query<Entity extends ObjectLiteral, TResult>(
    reason: CrossTenantScopeReason,
    repository: Repository<Entity>,
    alias: string,
    execute: (qb: SelectQueryBuilder<Entity>) => Promise<TResult>,
  ): Promise<TResult> {
    return this.tenantQueryScope.withCrossTenantScope(
      {
        reason,
        operationLabel: `admin_query:${repository.metadata.tableName}`,
        contextMarker: 'admin_query_engine',
      },
      async () => {
      const qb = repository.createQueryBuilder(alias);
      return execute(qb);
      },
    );
  }
}
