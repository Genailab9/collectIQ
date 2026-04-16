import { NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { requireAdminSession } from "@/lib/require-admin-api";
import { rejectIfForeignOrigin } from "@/lib/request-origin";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const originBlock = rejectIfForeignOrigin(req);
  if (originBlock) {
    return originBlock;
  }
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }
  const adminKey = process.env.COLLECTIQ_ADMIN_API_KEY?.trim();
  if (!adminKey) {
    return NextResponse.json({ message: "COLLECTIQ_ADMIN_API_KEY is not set on the app server." }, { status: 500 });
  }
  const { tenantId } = await params;
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  const res = await fetch(
    `${getBackendBaseUrl()}/saas/admin/tenants/${encodeURIComponent(tenantId)}/enabled`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CollectIQ-Admin-Key": adminKey,
        "X-CollectIQ-Admin-Role": auth.role,
        "X-CollectIQ-Admin-Actor": auth.username,
      },
      body: JSON.stringify({ enabled: body.enabled === true }),
    },
  );
  const out = await res.json().catch(() => ({}));
  return NextResponse.json(out, { status: res.status });
}
