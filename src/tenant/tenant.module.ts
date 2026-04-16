import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { TenantContextService } from './tenant-context.service';
import { TenantCorrelationResolverService } from './tenant-correlation-resolver.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantQueryScopeService } from './tenant-query-scope.service';
import { TenantQueryEngine } from './query-engines/tenant-query.engine';
import { AdminQueryEngine } from './query-engines/admin-query.engine';
import { SystemQueryEngine } from './query-engines/system-query.engine';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([StateTransitionLogEntity])],
  providers: [
    TenantContextService,
    TenantCorrelationResolverService,
    TenantQueryScopeService,
    TenantQueryEngine,
    AdminQueryEngine,
    SystemQueryEngine,
    TenantMiddleware,
  ],
  exports: [
    TenantContextService,
    TenantCorrelationResolverService,
    TenantQueryScopeService,
    TenantQueryEngine,
    AdminQueryEngine,
    SystemQueryEngine,
    TenantMiddleware,
  ],
})
export class TenantModule {}
