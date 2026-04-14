import { ApprovalOfferInvalidError } from './approval.errors';
import type { TenantApprovalPolicyEntity } from './entities/tenant-approval-policy.entity';
import type { ApprovalPolicyRoute } from '../../contracts/approval-policy.types';

export function assertOfferWithinTenantPolicyBounds(
  policy: TenantApprovalPolicyEntity,
  offerCents: number,
): void {
  if (policy.minOfferCents !== null && offerCents < policy.minOfferCents) {
    throw new ApprovalOfferInvalidError(
      `Offer ${offerCents} cents is below tenant minimum ${policy.minOfferCents} cents.`,
    );
  }
  if (policy.maxOfferCents !== null && offerCents > policy.maxOfferCents) {
    throw new ApprovalOfferInvalidError(
      `Offer ${offerCents} cents is above tenant maximum ${policy.maxOfferCents} cents.`,
    );
  }
}

export function routeOfferAgainstBand(
  policy: TenantApprovalPolicyEntity,
  offerCents: number,
): ApprovalPolicyRoute {
  if (offerCents >= policy.bandLowCents && offerCents <= policy.bandHighCents) {
    return 'AUTO_APPROVE';
  }
  return 'MANUAL_REVIEW';
}

export function computePendingDeadline(from: Date, policy: TenantApprovalPolicyEntity): Date {
  return new Date(from.getTime() + policy.pendingTimeoutSeconds * 1000);
}
