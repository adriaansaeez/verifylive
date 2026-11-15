import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const ACCESS_COOKIE = "veritas_access";
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_IP_LIMIT = 120;
const DEFAULT_SESSION_LIMIT = 90;

type Bucket = { count: number; resetAt: number };
type GlobalWithRateLimits = typeof globalThis & {
  __veritasRateLimits?: Map<string, Bucket>;
};

type MutationGuardOptions = {
  scope: string;
  sessionId?: string;
};

function positiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function rateBuckets(): Map<string, Bucket> {
  const store = globalThis as GlobalWithRateLimits;
  store.__veritasRateLimits ??= new Map();
  return store.__veritasRateLimits;
}

function accessDigest(token: string): string {
  return createHmac("sha256", token).update("veritas-live-access-v1").digest("base64url");
}

function equalSecret(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const entry of cookies.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || request.headers.get("x-veritas-token")?.trim() || null;
}

function authorized(request: Request): boolean {
  const expected = process.env.VERITAS_API_TOKEN?.trim();
  if (!expected) return true;

  const supplied = bearerToken(request);
  if (supplied && equalSecret(supplied, expected)) return true;

  const cookie = cookieValue(request, ACCESS_COOKIE);
  return Boolean(cookie && equalSecret(cookie, accessDigest(expected)));
}

function clientIp(request: Request): string {
  if (!/^(1|true|yes|on)$/i.test(process.env.VERITAS_TRUST_PROXY ?? "")) {
    return "untrusted-proxy";
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function consume(key: string, limit: number, now: number, windowMs: number): number | null {
  const buckets = rateBuckets();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (existing.count >= limit) return existing.resetAt;
  existing.count += 1;
  return null;
}

function rateLimited(resetAt: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000));
  return NextResponse.json(
    { error: "demasiadas solicitudes; inténtalo de nuevo más tarde" },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

/** Protects state-changing routes without exposing the configured token. */
export function protectMutation(
  request: Request,
  options: MutationGuardOptions,
): NextResponse | null {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "token de acceso requerido" },
      { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" } },
    );
  }

  const now = Date.now();
  const windowMs = positiveInteger("VERITAS_RATE_WINDOW_MS", DEFAULT_WINDOW_MS);
  const ipLimit = positiveInteger("VERITAS_RATE_IP_LIMIT", DEFAULT_IP_LIMIT);
  const sessionLimit = positiveInteger("VERITAS_RATE_SESSION_LIMIT", DEFAULT_SESSION_LIMIT);
  const ipReset = consume(`ip:${clientIp(request)}:${options.scope}`, ipLimit, now, windowMs);
  if (ipReset) return rateLimited(ipReset);

  if (options.sessionId) {
    const sessionReset = consume(
      `session:${options.sessionId}:${options.scope}`,
      sessionLimit,
      now,
      windowMs,
    );
    if (sessionReset) return rateLimited(sessionReset);
  }
  return null;
}

/** Exchanges a user-supplied demo token for a same-origin HttpOnly cookie. */
export function createAccessCookie(request: Request, token: string): NextResponse {
  const windowMs = positiveInteger("VERITAS_RATE_WINDOW_MS", DEFAULT_WINDOW_MS);
  const attemptLimit = positiveInteger("VERITAS_ACCESS_ATTEMPT_LIMIT", 10);
  const resetAt = consume(
    `access:${clientIp(request)}`,
    attemptLimit,
    Date.now(),
    Math.max(windowMs, 15 * 60_000),
  );
  if (resetAt) return rateLimited(resetAt);

  const expected = process.env.VERITAS_API_TOKEN?.trim();
  if (expected && !equalSecret(token, expected)) {
    return NextResponse.json(
      { error: "token de acceso inválido" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  if (expected) {
    response.cookies.set(ACCESS_COOKIE, accessDigest(expected), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api",
      maxAge: 8 * 60 * 60,
    });
  }
  return response;
}

export function resetRateLimitsForTests(): void {
  (globalThis as GlobalWithRateLimits).__veritasRateLimits?.clear();
}
