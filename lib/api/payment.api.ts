import { apiClient, RequestContext, withHeaders } from "./base";

export type PendingPaymentItem = {
  correlationId: string;
  paymentId: string;
  amountCents: number | null;
  currentState: string;
};

export async function createPaymentIntent(input: {
  amountCents: number;
  approvalCorrelationId: string;
  currency?: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<{ paymentId: string; toState: string; gatewayPaymentIntentId: string }> {
  const { idempotencyKey, headers } = withHeaders(input, "payment-intent");
  const { data } = await apiClient.post<{ paymentId: string; toState: string; gatewayPaymentIntentId: string }>(
    "/payments/intents",
    {
      amountCents: input.amountCents,
      approvalCorrelationId: input.approvalCorrelationId,
      currency: input.currency,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
  return data;
}

export async function confirmPayment(input: {
  paymentId: string;
  gatewayPaymentIntentId: string;
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<{ toState: string }> {
  const { idempotencyKey, headers } = withHeaders(input, "payment-confirm");
  const { data } = await apiClient.post<{ toState: string }>(
    `/payments/${encodeURIComponent(input.paymentId)}/confirm`,
    {
      gatewayPaymentIntentId: input.gatewayPaymentIntentId,
      idempotencyKey,
      borrowerOptedOut: input.borrowerOptedOut,
    },
    { headers },
  );
  return data;
}

export async function fetchPendingPayments(context: RequestContext = {}): Promise<PendingPaymentItem[]> {
  const { headers } = withHeaders(context, "payments-pending");
  const { data } = await apiClient.get<PendingPaymentItem[]>("/payments/pending", { headers });
  return data;
}

