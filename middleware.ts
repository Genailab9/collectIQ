import { NextResponse, type NextRequest } from "next/server";
import { ONBOARDING_COOKIE, SESSION_COOKIE } from "@/lib/session-constants";

const PUBLIC_PATHS = ["/login"];

function isMaintenanceMode(): boolean {
  return process.env.NEXT_PUBLIC_COLLECTIQ_MAINTENANCE === "1";
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isMaintenanceMode()) {
    if (
      pathname === "/maintenance" ||
      pathname === "/login" ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/_next/") ||
      pathname === "/favicon.ico"
    ) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/maintenance", req.url));
  }

  if (pathname === "/maintenance") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionRaw = req.cookies.get(SESSION_COOKIE)?.value || "";
  const session = parseSessionForMiddleware(sessionRaw);
  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    (pathname.startsWith("/admin") || pathname.startsWith("/system")) &&
    session.role !== "admin"
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (pathname === "/onboarding" && session.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (pathname !== "/onboarding" && pathname !== "/api/onboarding/activate") {
    const onboardingDone = req.cookies.get(ONBOARDING_COOKIE)?.value === "done";
    if (!onboardingDone) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
  }

  return NextResponse.next();
}

function parseSessionForMiddleware(
  token: string,
): { role: "admin" | "operator"; exp: number } | null {
  if (!token) {
    return null;
  }
  const [payloadBase64] = token.split(".");
  if (!payloadBase64) {
    return null;
  }
  try {
    const json = atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as { role?: string; exp?: number };
    if (
      (parsed.role !== "admin" && parsed.role !== "operator") ||
      typeof parsed.exp !== "number" ||
      Date.now() > parsed.exp
    ) {
      return null;
    }
    return { role: parsed.role, exp: parsed.exp };
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)"],
};

