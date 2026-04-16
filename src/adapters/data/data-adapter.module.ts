import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DATA_EXECUTION_PORT } from '../adapter.tokens';
import { DataExecutionAdapter } from './data-execution.adapter';
import { DataIngestionRecordEntity } from '../../modules/ingestion/entities/data-ingestion-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DataIngestionRecordEntity])],
  providers: [DataExecutionAdapter, { provide: DATA_EXECUTION_PORT, useExisting: DataExecutionAdapter }],
  exports: [DATA_EXECUTION_PORT],
})
export class DataAdapterModule {}
