import { NextResponse } from "next/server";
import { ONBOARDING_COOKIE } from "@/lib/session-constants";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ONBOARDING_COOKIE, "done", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

