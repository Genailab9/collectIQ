import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ResilienceModule } from '../common/resilience/resilience.module';
import { RecoveryModule } from '../recovery/recovery.module';
import { SurvivalModule } from '../survival/survival.module';
import { SaaSCoreModule } from './saas-core.module';
import { SaaSAdminController } from './saas-admin.controller';
import { SaaSAdminGuard } from './saas-admin.guard';

@Module({
  imports: [SaaSCoreModule, RecoveryModule, ResilienceModule, ConfigModule, SurvivalModule],
  controllers: [SaaSAdminController],
  providers: [SaaSAdminGuard],
})
export class SaaSAdminModule {}
