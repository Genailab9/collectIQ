import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseHealthService } from '../../database/database-health.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RootHealthController } from './root-health.controller';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController, RootHealthController],
  providers: [HealthService, DatabaseHealthService],
})
export class HealthModule {}
