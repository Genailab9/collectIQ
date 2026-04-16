import { NextRequest, NextResponse } from "next/server";
import { rejectIfForeignOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "collectiq_tenant_id";
const MAX_AGE = 60 * 60 * 24 * 30;
const LEGACY_COOKIE = "collectiq:tenantId";

function buildSetCookie(tenantId: string): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(tenantId.trim())}`,
    `Max-Age=${MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearLegacyTenantCookie(): string {
  return `${LEGACY_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export async function GET(req: NextRequest) {
  const originBlock = rejectIfForeignOrigin(req);
  if (originBlock) {
    return originBlock;
  }
  const raw = req.cookies.get(COOKIE_NAME)?.value;
  const tenantId = raw ? decodeURIComponent(raw).trim() : "";
  return NextResponse.json({ tenantId: tenantId.length > 0 ? tenantId : null });
}

export async function POST(req: NextRequest) {
  const originBlock = rejectIfForeignOrigin(req);
  if (originBlock) {
    return originBlock;
  }
  let body: { tenantId?: unknown };
  try {
    body = (await req.json()) as { tenantId?: unknown };
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId || tenantId.length > 128) {
    return NextResponse.json({ message: "tenantId is required (max 128 chars)." }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, tenantId });
  res.headers.append("Set-Cookie", buildSetCookie(tenantId));
  res.headers.append("Set-Cookie", clearLegacyTenantCookie());
  return res;
}
