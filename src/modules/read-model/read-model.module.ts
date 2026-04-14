import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmekOrchestrationAuditEntity } from '../../kernel/entities/smek-orchestration-audit.entity';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { DataIngestionRecordEntity } from '../ingestion/entities/data-ingestion-record.entity';
import { TransitionReadModelService } from './transition-read-model.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      StateTransitionLogEntity,
      SmekOrchestrationAuditEntity,
      DataIngestionRecordEntity,
    ]),
  ],
  providers: [TransitionReadModelService],
  exports: [TransitionReadModelService],
})
export class ReadModelModule {}
