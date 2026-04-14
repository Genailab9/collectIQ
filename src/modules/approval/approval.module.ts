import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelModule } from '../../kernel/kernel.module';
import { ReadModelModule } from '../read-model/read-model.module';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { ApprovalController } from './approval.controller';
import { ApprovalEscalationScheduler } from './approval-escalation.scheduler';
import { ApprovalPolicySeedService } from './approval-policy-seed.service';
import { ApprovalService } from './approval.service';
import { ApprovalTransitionQueryService } from './approval-transition-query.service';
import { TenantApprovalPolicyEntity } from './entities/tenant-approval-policy.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantApprovalPolicyEntity, StateTransitionLogEntity]),
    KernelModule,
    ReadModelModule,
  ],
  controllers: [ApprovalController],
  providers: [
    ApprovalPolicySeedService,
    ApprovalTransitionQueryService,
    ApprovalService,
    ApprovalEscalationScheduler,
  ],
  exports: [ApprovalService, ApprovalTransitionQueryService],
})
export class ApprovalModule {}
