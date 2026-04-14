import { Module } from '@nestjs/common';
import { ReadModelModule } from '../read-model/read-model.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [ReadModelModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
