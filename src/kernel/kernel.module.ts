import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataAdapterModule } from '../adapters/data/data-adapter.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { ResilienceModule } from '../common/resilience/resilience.module';
import { StateMachineModule } from '../state-machine/state-machine.module';
import { TenantFeatureFlagModule } from '../modules/tenant-feature-flags/tenant-feature-flag.module';
import { EventsStreamModule } from '../events/stream/events-stream.module';
import { SmekOrchestrationAuditEntity } from './entities/smek-orchestration-audit.entity';
import { PrdSystemValidityService } from './prd-system-validity.service';
import { SmekKernelService } from './smek-kernel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SmekOrchestrationAuditEntity]),
    DataAdapterModule,
    ComplianceModule,
    TenantFeatureFlagModule,
    ResilienceModule,
    StateMachineModule,
    EventsStreamModule,
  ],
  providers: [SmekKernelService, PrdSystemValidityService],
  exports: [SmekKernelService],
})
export class KernelModule {}
