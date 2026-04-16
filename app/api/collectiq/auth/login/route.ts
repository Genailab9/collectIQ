import { NextResponse } from "next/server";
import { createSessionToken, type UserRole } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/session-constants";

type LoginBody = {
  username?: string;
  password?: string;
};

function configuredOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function roleForCredentials(username: string, password: string): UserRole | null {
  const adminUser = configuredOrDefault("COLLECTIQ_ADMIN_USER", "admin");
  const adminPass = configuredOrDefault("COLLECTIQ_ADMIN_PASSWORD", "admin123");
  if (username === adminUser && password === adminPass) {
    return "admin";
  }

  const operatorUser = configuredOrDefault("COLLECTIQ_OPERATOR_USER", "operator");
  const operatorPass = configuredOrDefault("COLLECTIQ_OPERATOR_PASSWORD", "operator123");
  if (username === operatorUser && password === operatorPass) {
    return "operator";
  }
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as LoginBody;
  const username = (body.username?.trim() || "").slice(0, 128);
  const password = (body.password?.trim() || "").slice(0, 256);
  let role: UserRole | null = null;
  role = roleForCredentials(username, password);
  if (!role) {
    return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
  }

  const token = createSessionToken({
    username,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 8,
  });
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
