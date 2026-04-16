import { apiClient, RequestContext, withHeaders } from "./base";

type Decision = "APPROVE" | "REJECT" | "COUNTER";

export type PendingApprovalItem = {
  correlationId: string;
  tenantId: string;
  borrower: { name?: string; phone?: string; accountNumber?: string };
  negotiatedAmountCents: number | null;
  priority: { score?: number; label?: string } | null;
  currentState: string;
  queueStage: "WAITING_APPROVAL";
};

async function sendDecision(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  decision: Decision;
  counterOfferAmountCents?: number;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<unknown> {
  const { idempotencyKey, headers } = withHeaders(input, `decision-${input.decision.toLowerCase()}`);
  const { data } = await apiClient.post(
    `/approvals/${encodeURIComponent(input.correlationId)}/decisions`,
    {
      fromState: input.fromState,
      decision: input.decision,
      officerId: input.officerId,
      idempotencyKey,
      counterOfferAmountCents: input.counterOfferAmountCents,
    },
    { headers },
  );
  return data;
}

export function approveRequest(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  tenantId?: string;
  idempotencyKey?: string;
}) {
  return sendDecision({ ...input, decision: "APPROVE" });
}

export function rejectRequest(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  tenantId?: string;
  idempotencyKey?: string;
}) {
  return sendDecision({ ...input, decision: "REJECT" });
}

export function counterOfferRequest(input: {
  correlationId: string;
  fromState: string;
  officerId: string;
  counterOfferAmountCents: number;
  tenantId?: string;
  idempotencyKey?: string;
}) {
  return sendDecision({ ...input, decision: "COUNTER" });
}

export async function fetchPendingApprovals(context: RequestContext = {}): Promise<PendingApprovalItem[]> {
  const { headers } = withHeaders(context, "approvals-pending");
  const { data } = await apiClient.get<PendingApprovalItem[]>("/approvals/pending", { headers });
  return data;
}

