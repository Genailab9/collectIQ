import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallTransitionQueryService } from '../../adapters/telephony/call-transition-query.service';
import { KernelModule } from '../../kernel/kernel.module';
import { ReadModelModule } from '../read-model/read-model.module';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { SettlementExecutionController } from './settlement-execution.controller';
import { SettlementExecutionService } from './settlement-execution.service';

@Module({
  imports: [TypeOrmModule.forFeature([StateTransitionLogEntity]), KernelModule, ReadModelModule],
  controllers: [SettlementExecutionController],
  providers: [CallTransitionQueryService, SettlementExecutionService],
  exports: [SettlementExecutionService],
})
export class SettlementExecutionModule {}
