import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelModule } from '../../kernel/kernel.module';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { SyncCaseSnapshotEntity } from './entities/sync-case-snapshot.entity';
import { SyncService } from './sync.service';
import { SyncTransitionQueryService } from './sync-transition.query';

@Module({
  imports: [
    TypeOrmModule.forFeature([StateTransitionLogEntity, SyncCaseSnapshotEntity]),
    KernelModule,
  ],
  providers: [SyncTransitionQueryService, SyncService],
  exports: [SyncService, SyncTransitionQueryService],
})
export class SyncModule {}
