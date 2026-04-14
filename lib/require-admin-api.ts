import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-constants";
import { verifySessionToken } from "@/lib/session";

export async function requireAdminSession(): Promise<
  | { ok: true; username: string }
  | { ok: false; response: NextResponse }
> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? "";
  const session = token ? verifySessionToken(token) : null;
  if (!session || session.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ message: "Admin access required." }, { status: 403 }),
    };
  }
  return { ok: true, username: session.username };
}
