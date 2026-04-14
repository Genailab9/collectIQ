import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StateTransitionLogEntity } from '../state-machine/entities/state-transition-log.entity';
import { TenantContextService } from './tenant-context.service';
import { TenantCorrelationResolverService } from './tenant-correlation-resolver.service';
import { TenantMiddleware } from './tenant.middleware';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([StateTransitionLogEntity])],
  providers: [TenantContextService, TenantCorrelationResolverService, TenantMiddleware],
  exports: [TenantContextService, TenantCorrelationResolverService, TenantMiddleware],
})
export class TenantModule {}
