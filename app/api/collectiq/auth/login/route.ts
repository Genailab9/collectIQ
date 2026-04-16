import { NextResponse } from "next/server";
import { createSessionToken, type UserRole } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/session-constants";

type LoginBody = {
  username?: string;
  password?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function roleForCredentials(username: string, password: string): UserRole | null {
  const adminUser = requiredEnv("COLLECTIQ_ADMIN_USER");
  const adminPass = requiredEnv("COLLECTIQ_ADMIN_PASSWORD");
  if (username === adminUser && password === adminPass) {
    return "admin";
  }

  const operatorUser = requiredEnv("COLLECTIQ_OPERATOR_USER");
  const operatorPass = requiredEnv("COLLECTIQ_OPERATOR_PASSWORD");
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
  try {
    role = roleForCredentials(username, password);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? `Authentication is not configured: ${error.message}`
            : "Authentication is not configured.",
      },
      { status: 500 },
    );
  }
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
