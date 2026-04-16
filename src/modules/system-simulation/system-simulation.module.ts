import { Module } from '@nestjs/common';
import { TenantFeatureFlagModule } from '../tenant-feature-flags/tenant-feature-flag.module';
import { TenantModule } from '../../tenant/tenant.module';
import { SystemSimulationController } from './system-simulation.controller';

@Module({
  imports: [TenantFeatureFlagModule, TenantModule],
  controllers: [SystemSimulationController],
})
export class SystemSimulationModule {}
