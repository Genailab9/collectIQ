import { apiClient, withHeaders } from "./base";

export async function uploadIngestionFile(input: {
  accounts: unknown[];
  borrowerOptedOut?: boolean;
  tenantId?: string;
  idempotencyKey?: string;
  campaignId?: string;
}): Promise<{
  accepted: Array<{ index: number; correlation_id: string; record_id: string }>;
  rejected: Array<{ index: number; reason: string }>;
}> {
  const { idempotencyKey, headers } = withHeaders(input, "ingestion-upload");
  const { data } = await apiClient.post<{
    accepted: Array<{ index: number; correlation_id: string; record_id: string }>;
    rejected: Array<{ index: number; reason: string }>;
  }>(
    "/ingestion/upload",
    {
      idempotency_key: idempotencyKey,
      accounts: input.accounts,
      borrower_opted_out: input.borrowerOptedOut,
      ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
    },
    { headers },
  );
  return data;
}

