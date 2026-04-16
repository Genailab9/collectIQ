import { NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { requireAdminSession } from "@/lib/require-admin-api";
import { rejectIfForeignOrigin } from "@/lib/request-origin";

export async function POST(req: Request) {
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
  const res = await fetch(`${getBackendBaseUrl()}/saas/admin/recovery/trigger`, {
    method: "POST",
    headers: {
      "X-CollectIQ-Admin-Key": adminKey,
      "X-CollectIQ-Admin-Role": auth.role,
      "X-CollectIQ-Admin-Actor": auth.username,
    },
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
