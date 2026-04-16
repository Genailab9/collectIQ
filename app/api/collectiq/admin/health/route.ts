import { NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { requireAdminSession } from "@/lib/require-admin-api";

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return auth.response;
  }
  const adminKey = process.env.COLLECTIQ_ADMIN_API_KEY?.trim();
  if (!adminKey) {
    return NextResponse.json({ message: "COLLECTIQ_ADMIN_API_KEY is not set on the app server." }, { status: 500 });
  }
  const res = await fetch(`${getBackendBaseUrl()}/saas/admin/system-health`, {
    headers: {
      "X-CollectIQ-Admin-Key": adminKey,
      "X-CollectIQ-Admin-Role": auth.role,
      "X-CollectIQ-Admin-Actor": auth.username,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
