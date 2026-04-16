import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurvivalCoreModule } from '../survival/survival-core.module';
import { StateTransitionLogEntity } from './entities/state-transition-log.entity';
import { MachineRegistryService } from './machine-registry.service';
import { StateMachineService } from './state-machine.service';
import { TransitionEventLoggerQueryService } from './transition-event-logger.query';
import { TransitionEventLoggerService } from './transition-event-logger.service';
import { TransitionValidatorService } from './transition-validator.service';

@Module({
  imports: [TypeOrmModule.forFeature([StateTransitionLogEntity]), SurvivalCoreModule],
  providers: [
    MachineRegistryService,
    TransitionValidatorService,
    TransitionEventLoggerQueryService,
    TransitionEventLoggerService,
    StateMachineService,
  ],
  exports: [StateMachineService, MachineRegistryService],
})
export class StateMachineModule {}
