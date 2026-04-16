import { Injectable } from '@nestjs/common';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { TenantQueryScopeService } from '../tenant-query-scope.service';

@Injectable()
export class TenantQueryEngine {
  constructor(private readonly tenantQueryScope: TenantQueryScopeService) {}

  async query<Entity extends ObjectLiteral, TResult>(
    repository: Repository<Entity>,
    alias: string,
    tenantId: string,
    execute: (qb: SelectQueryBuilder<Entity>) => Promise<TResult>,
  ): Promise<TResult> {
    const qb = this.tenantQueryScope.forRepo(repository, alias, tenantId);
    return execute(qb);
  }
}
