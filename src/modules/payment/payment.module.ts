import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KernelModule } from '../../kernel/kernel.module';
import { SmekOrchestrationAuditEntity } from '../../kernel/entities/smek-orchestration-audit.entity';
import { StateTransitionLogEntity } from '../../state-machine/entities/state-transition-log.entity';
import { PaymentGatewayIntentLinkEntity } from './entities/payment-gateway-intent-link.entity';
import { ApprovalModule } from '../approval/approval.module';
import { ReadModelModule } from '../read-model/read-model.module';
import { SyncModule } from '../sync/sync.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentTransitionQueryService } from './payment-transition-query.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StateTransitionLogEntity,
      SmekOrchestrationAuditEntity,
      PaymentGatewayIntentLinkEntity,
    ]),
    KernelModule,
    ApprovalModule,
    SyncModule,
    ReadModelModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentTransitionQueryService, PaymentService],
  exports: [PaymentService, PaymentTransitionQueryService],
})
export class PaymentModule {}
