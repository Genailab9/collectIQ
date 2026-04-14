import { NextResponse } from "next/server";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Mitigates cross-site request forgery for same-site-cookie-authenticated BFF routes
 * by requiring a matching Origin (or Referer) when NEXT_PUBLIC_APP_URL is set.
 */
export function rejectIfForeignOrigin(req: Request): NextResponse | null {
  const method = req.method.toUpperCase();
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    return null;
  }
  const allowed = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!allowed) {
    return null;
  }
  const base = stripTrailingSlash(allowed);
  const origin = req.headers.get("origin");
  if (origin) {
    const o = stripTrailingSlash(origin);
    if (o !== base && !o.startsWith(`${base}/`)) {
      return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
    }
    return null;
  }
  const referer = req.headers.get("referer");
  if (referer && !referer.startsWith(`${base}/`) && referer !== base) {
    return NextResponse.json({ message: "Request referer is not allowed." }, { status: 403 });
  }
  return null;
}
