import { Injectable } from '@nestjs/common';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { TenantQueryScopeService } from '../tenant-query-scope.service';

@Injectable()
export class SystemQueryEngine {
  constructor(private readonly tenantQueryScope: TenantQueryScopeService) {}

  async query<Entity extends ObjectLiteral, TResult>(
    repository: Repository<Entity>,
    alias: string,
    execute: (qb: SelectQueryBuilder<Entity>) => Promise<TResult>,
  ): Promise<TResult> {
    return this.tenantQueryScope.withCrossTenantScope(
      {
        reason: 'admin.system',
        operationLabel: `system_query:${repository.metadata.tableName}`,
        contextMarker: 'system_query_engine',
      },
      async () => {
        const qb = repository.createQueryBuilder(alias);
        return execute(qb);
      },
    );
  }
}
