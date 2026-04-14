import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantApprovalPolicyEntity } from '../../modules/approval/entities/tenant-approval-policy.entity';
import { APPROVAL_ADAPTER } from '../adapter.tokens';
import { CollectiqApprovalAdapter } from './collectiq-approval.adapter';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantApprovalPolicyEntity])],
  providers: [
    CollectiqApprovalAdapter,
    { provide: APPROVAL_ADAPTER, useExisting: CollectiqApprovalAdapter },
  ],
  exports: [
    CollectiqApprovalAdapter,
    { provide: APPROVAL_ADAPTER, useExisting: CollectiqApprovalAdapter },
  ],
})
export class ApprovalAdapterModule {}
