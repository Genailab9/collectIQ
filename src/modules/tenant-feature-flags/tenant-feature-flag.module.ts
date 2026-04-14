import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantFeatureFlagEntity } from './tenant-feature-flag.entity';
import { TenantFeatureFlagController } from './tenant-feature-flag.controller';
import { ExecutionFeatureFlagsService } from './execution-feature-flags.service';
import { TenantFeatureFlagService } from './tenant-feature-flag.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantFeatureFlagEntity])],
  controllers: [TenantFeatureFlagController],
  providers: [TenantFeatureFlagService, ExecutionFeatureFlagsService],
  exports: [TenantFeatureFlagService, ExecutionFeatureFlagsService],
})
export class TenantFeatureFlagModule {}
