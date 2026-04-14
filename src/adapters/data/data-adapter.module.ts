import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DATA_EXECUTION_PORT } from '../adapter.tokens';
import { DataExecutionBridge } from './data-execution.bridge';
import { DataIngestionRecordEntity } from '../../modules/ingestion/entities/data-ingestion-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DataIngestionRecordEntity])],
  providers: [DataExecutionBridge, { provide: DATA_EXECUTION_PORT, useExisting: DataExecutionBridge }],
  exports: [DATA_EXECUTION_PORT],
})
export class DataAdapterModule {}
