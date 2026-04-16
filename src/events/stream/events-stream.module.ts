import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantModule } from '../../tenant/tenant.module';
import { SseEventsController } from './sse-events.controller';
import { TenantEventStreamService } from './tenant-event-stream.service';

@Module({
  imports: [TenantModule, ConfigModule],
  controllers: [SseEventsController],
  providers: [TenantEventStreamService],
  exports: [TenantEventStreamService],
})
export class EventsStreamModule {}
