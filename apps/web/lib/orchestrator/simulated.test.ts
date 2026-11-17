import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "verifylive-sim-"));
  process.env.VERIFYLIVE_DB = join(dir, "sim.sqlite");
  delete (globalThis as { __verifyliveDb?: unknown }).__verifyliveDb;
  // Modo simulado: sin clave de NaN.
  vi.stubEnv("NAN_KEY", "");
  vi.stubEnv("NAN_CHAT_MODEL", "");
  vi.stubEnv("VERIFYLIVE_SEARXNG_URL", "");
  vi.stubEnv("VERIFYLIVE_SEARCH_PROVIDER", "none");
  vi.stubEnv("VERIFYLIVE_ENABLE_WIKIPEDIA", "false");
});
afterEach(() => {
  delete (globalThis as { __verifyliveDb?: unknown }).__verifyliveDb;
  delete process.env.VERIFYLIVE_DB;
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Anyone who clones this repo runs it with no keys at all, so the keyless
 * path is the first thing they see. Every change to the gate, the evidence
 * pipeline or the verdict policy has to keep it working.
 */
describe("modo simulado (sin NAN_KEY)", () => {
  it("detecta afirmaciones y emite veredictos marcados como simulados", async () => {
    const { createSession } = await import("@/lib/db/repo");
    const { ingestSegment } = await import("@/lib/orchestrator");
    const { listClaimsWithEvidence } = await import("@/lib/db/repo");
    const { runtimeConfig } = await import("@/lib/config");

    expect(runtimeConfig().clefMode).toBe("simulated");

    const session = createSession({ id: "ses_sim", sourceType: "fixture" });
    const result = await ingestSegment({
      sessionId: session.id,
      startMs: 0,
      endMs: 7000,
      text: "El agua hierve a cien grados Celsius al nivel del mar.",
    });

    expect(result).not.toBeNull();
    expect(result!.claims.length).toBeGreaterThan(0);

    // Deja que el análisis termine.
    await new Promise((r) => setTimeout(r, 1500));
    const claims = listClaimsWithEvidence(session.id);
    for (const claim of claims) {
      for (const revision of claim.revisions) {
        // Never present a local heuristic as if it were Clef.
        expect(revision.simulated).toBe(true);
        expect(revision.summary).toContain("simulado");
      }
    }
    expect(claims.some((claim) => claim.status === "resolved")).toBe(true);
    expect(claims.every((claim) => claim.error === null)).toBe(true);
  });
});
