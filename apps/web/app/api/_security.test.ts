import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAccessCookie,
  protectMutation,
  resetRateLimitsForTests,
} from "./_security";

const ENV_NAMES = [
  "VERITAS_API_TOKEN",
  "VERITAS_TRUST_PROXY",
  "VERITAS_RATE_WINDOW_MS",
  "VERITAS_RATE_IP_LIMIT",
  "VERITAS_RATE_SESSION_LIMIT",
  "VERITAS_ACCESS_ATTEMPT_LIMIT",
] as const;
const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

function request(headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/sessions", { method: "POST", headers });
}

beforeEach(() => {
  resetRateLimitsForTests();
  for (const name of ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("mutation protection", () => {
  it("does not require a token when the MVP guard is not configured", () => {
    expect(protectMutation(request(), { scope: "create" })).toBeNull();
  });

  it("accepts a bearer token and rejects a missing token", () => {
    process.env.VERITAS_API_TOKEN = "demo-secret";
    expect(protectMutation(request(), { scope: "create" })?.status).toBe(401);
    expect(
      protectMutation(request({ Authorization: "Bearer demo-secret" }), { scope: "create" }),
    ).toBeNull();
  });

  it("exchanges the token for an HttpOnly cookie without returning it in JSON", async () => {
    process.env.VERITAS_API_TOKEN = "demo-secret";
    const response = createAccessCookie(request(), "demo-secret");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("veritas_access=");
    expect(setCookie).toContain("HttpOnly");
    expect(await response.json()).toEqual({ ok: true });
    expect(JSON.stringify(await createAccessCookie(request(), "wrong").json())).not.toContain(
      "demo-secret",
    );

    const cookie = setCookie.split(";")[0] ?? "";
    expect(protectMutation(request({ Cookie: cookie }), { scope: "create" })).toBeNull();
  });

  it("limits both IP and session buckets", () => {
    process.env.VERITAS_TRUST_PROXY = "true";
    process.env.VERITAS_RATE_IP_LIMIT = "10";
    process.env.VERITAS_RATE_SESSION_LIMIT = "1";
    const headers = { "x-forwarded-for": "203.0.113.7" };
    expect(
      protectMutation(request(headers), { scope: "segments", sessionId: "ses_1" }),
    ).toBeNull();
    expect(
      protectMutation(request(headers), { scope: "segments", sessionId: "ses_1" })?.status,
    ).toBe(429);

    resetRateLimitsForTests();
    process.env.VERITAS_RATE_IP_LIMIT = "1";
    process.env.VERITAS_RATE_SESSION_LIMIT = "10";
    expect(protectMutation(request(headers), { scope: "create" })).toBeNull();
    expect(protectMutation(request(headers), { scope: "create" })?.status).toBe(429);
  });
});
