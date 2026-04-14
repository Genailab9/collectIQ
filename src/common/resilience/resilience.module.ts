import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeatureFlagModule } from '../../feature-flags/feature-flag.module';
import { ResilienceService } from './resilience.service';

@Global()
@Module({
  imports: [ConfigModule, FeatureFlagModule],
  providers: [ResilienceService],
  exports: [ResilienceService],
})
export class ResilienceModule {}
