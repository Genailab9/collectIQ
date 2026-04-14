import type { AdapterEnvelope } from '../../contracts/adapter-envelope';
import type { ApprovalPolicyAdapterResult } from '../../contracts/approval-policy.types';

export interface ApprovalAdapter {
  evaluateApproval(input: {
    tenantId: string;
    offerAmountCents: number;
  }): Promise<ApprovalPolicyAdapterResult>;
  execute(envelope: AdapterEnvelope): Promise<unknown>;
}
