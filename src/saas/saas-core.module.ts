import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurvivalModule } from '../survival/survival.module';
import { TenantSaaSProfileEntity } from './entities/tenant-saas-profile.entity';
import { SaaSTenantService } from './saas-tenant.service';
import { SaaSUsageService } from './saas-usage.service';
import { SaaSTenantController } from './saas-tenant.controller';
import { SaaSBillingController } from './saas-billing.controller';
import { SaaSAuditController } from './saas-audit.controller';
import { SaaSUsageMiddleware } from './saas-usage.middleware';
import { SaaSTenantStatusMiddleware } from './saas-tenant-status.middleware';

@Module({
  imports: [TypeOrmModule.forFeature([TenantSaaSProfileEntity]), SurvivalModule],
  controllers: [SaaSTenantController, SaaSBillingController, SaaSAuditController],
  providers: [SaaSTenantService, SaaSUsageService, SaaSUsageMiddleware, SaaSTenantStatusMiddleware],
  exports: [SaaSTenantService, SaaSUsageService, SaaSUsageMiddleware, SaaSTenantStatusMiddleware],
})
export class SaaSCoreModule {}
