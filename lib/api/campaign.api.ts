import { apiClient, RequestContext, withHeaders } from "./base";

export type CampaignDto = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export async function listCampaignsApi(context: RequestContext = {}): Promise<CampaignDto[]> {
  const { headers } = withHeaders(context, "campaigns-list");
  const { data } = await apiClient.get<CampaignDto[]>("/campaigns", { headers });
  return data;
}

export async function createCampaignApi(
  input: { name: string; description?: string | null } & RequestContext,
): Promise<CampaignDto> {
  const { headers } = withHeaders(input, "campaign-create");
  const { data } = await apiClient.post<CampaignDto>(
    "/campaigns",
    {
      name: input.name,
      ...(input.description != null ? { description: input.description } : {}),
    },
    { headers },
  );
  return data;
}

