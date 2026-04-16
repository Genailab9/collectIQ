import { createHmac, timingSafeEqual } from "crypto";
import { ONBOARDING_COOKIE, SESSION_COOKIE } from "@/lib/session-constants";

export type UserRole = "admin" | "operator";

export type SessionPayload = {
  username: string;
  role: UserRole;
  exp: number;
};

export { SESSION_COOKIE, ONBOARDING_COOKIE };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function sessionSecret(): string {
  return requiredEnv("COLLECTIQ_SESSION_SECRET");
}

function sign(payloadBase64: string): string {
  return createHmac("sha256", sessionSecret()).update(payloadBase64).digest("hex");
}

export function createSessionToken(payload: SessionPayload): string {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadBase64}.${sign(payloadBase64)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }
  const expected = sign(payloadBase64);
  const safe =
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!safe) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as SessionPayload;
    if (!payload?.username || !payload?.role || typeof payload.exp !== "number") {
      return null;
    }
    if (Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

