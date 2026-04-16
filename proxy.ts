import { NextResponse, type NextRequest } from "next/server";
import { ONBOARDING_COOKIE, SESSION_COOKIE } from "@/lib/session-constants";

const PUBLIC_PATHS = ["/login"];

function isMaintenanceMode(): boolean {
  return process.env.NEXT_PUBLIC_COLLECTIQ_MAINTENANCE === "1";
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/collectiq/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export function proxy(req: NextRequest) {
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

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname !== "/onboarding" && pathname !== "/api/collectiq/onboarding/activate") {
    const onboardingDone = req.cookies.get(ONBOARDING_COOKIE)?.value === "done";
    if (!onboardingDone) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
  }

  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!.*\\..*|_next).*)"],
};
