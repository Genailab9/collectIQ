import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/backend-url";
import { rejectIfForeignOrigin } from "@/lib/request-origin";
import bffContract from "@/config/bff-contract.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "proxy-connection"]);

/**
 * Only paths the CollectIQ UI is allowed to reach via this BFF (blast-radius control).
 * Extend when adding new apiClient routes — keep off admin/system planes.
 */
function isBffBackendPathAllowed(path: string): boolean {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (bffContract.allowedBackendExact.includes(p)) {
    return true;
  }
  if (bffContract.allowedBackendPrefixes.some((pre) => p.startsWith(pre))) {
    return true;
  }
  return false;
}

const PASS_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "authorization",
  "content-type",
  "cookie",
  "x-idempotency-key",
]);

const TENANT_COOKIE = "collectiq_tenant_id";

async function proxy(req: NextRequest, segments: string[]): Promise<Response> {
  const originBlock = rejectIfForeignOrigin(req);
  if (originBlock) {
    return originBlock;
  }

  let backend: string;
  try {
    backend = getBackendBaseUrl().replace(/\/$/, "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Missing backend URL.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }

  const path = `/${segments.join("/")}`;
  if (!isBffBackendPathAllowed(path)) {
    return NextResponse.json({ message: "This path is not allowed through the CollectIQ BFF." }, { status: 403 });
  }
  const target = `${backend}${path}${req.nextUrl.search}`;
  const method = req.method.toUpperCase();

  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    const lower = k.toLowerCase();
    if (PASS_HEADERS.has(lower)) {
      headers.set(k, v);
    }
  }
  const apiKey = process.env.COLLECTIQ_API_KEY?.trim();
  if (apiKey) {
    headers.set("X-CollectIQ-Api-Key", apiKey);
  }

  const fromCookie = req.cookies.get(TENANT_COOKIE)?.value?.trim();
  if (fromCookie) {
    try {
      headers.set("x-collectiq-tenant-id", decodeURIComponent(fromCookie));
    } catch {
      headers.set("x-collectiq-tenant-id", fromCookie);
    }
  }

  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    const body = await req.arrayBuffer();
    if (body.byteLength > 0) {
      init.body = body;
    }
  }

  const upstream = await fetch(target, init);

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) {
      return;
    }
    outHeaders.set(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

type RouteCtx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}
