import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "veritas-repo-"));
  process.env.VERITAS_DB = join(dir, "test.sqlite");
  delete (globalThis as { __veritasDb?: unknown }).__veritasDb;
});

afterEach(() => {
  delete (globalThis as { __veritasDb?: unknown }).__veritasDb;
  delete process.env.VERITAS_DB;
  rmSync(dir, { recursive: true, force: true });
});

describe("closeStaleSessions", () => {
  it("leaves a capture that is still running alone", async () => {
    const repo = await import("@/lib/db/repo");
    const session = repo.createSession({ id: "ses_live", sourceType: "tab" });
    repo.setSessionStatus(session.id, "capturing");

    expect(repo.closeStaleSessions()).toBe(0);
    expect(repo.getSession("ses_live")?.status).toBe("capturing");
  });

  it("closes a capture abandoned without a stop", async () => {
    const repo = await import("@/lib/db/repo");
    const session = repo.createSession({ id: "ses_old", sourceType: "tab" });
    repo.setSessionStatus(session.id, "capturing");

    expect(repo.closeStaleSessions(Date.now() + 11 * 60_000)).toBe(1);
    const closed = repo.getSession("ses_old");
    expect(closed?.status).toBe("finished");
    expect(closed?.finishedAt).not.toBeNull();
    expect(closed?.error).toContain("abandonó");
  });

  it("never reopens or re-stamps a session that finished properly", async () => {
    const repo = await import("@/lib/db/repo");
    const session = repo.createSession({ id: "ses_done", sourceType: "mic" });
    const finished = repo.setSessionStatus(session.id, "finished", { finished: true });

    expect(repo.closeStaleSessions(Date.now() + 11 * 60_000)).toBe(0);
    expect(repo.getSession("ses_done")?.finishedAt).toBe(finished?.finishedAt);
    expect(repo.getSession("ses_done")?.error).toBeNull();
  });
});

describe("migración de esquema en caliente", () => {
  it("recupera una tabla que falta en una conexión ya abierta", async () => {
    // Esto es lo que mató 18 análisis: el servidor cachea la conexión en
    // globalThis, así que una tabla añadida después de arrancar no existía.
    const repo = await import("@/lib/db/repo");
    const { getDb } = await import("@/lib/db/client");

    repo.setPublisherTier("elpais.com", "reliable_secondary");
    const db = getDb();
    db.exec("DROP TABLE publishers");
    // La conexión sigue viva y cacheada; marcamos el esquema como anticuado.
    db.exec("PRAGMA user_version = 0");

    expect(() => repo.setPublisherTier("rtve.es", "reliable_secondary")).not.toThrow();
    expect(repo.getPublisherTier("rtve.es")).toBe("reliable_secondary");
  });

  it("no reescribe el esquema cuando ya está al día", async () => {
    const { getDb } = await import("@/lib/db/client");
    const repo = await import("@/lib/db/repo");

    repo.setPublisherTier("abc.es", "reliable_secondary");
    getDb();
    // Una llamada posterior no debe perder lo ya guardado.
    getDb();
    expect(repo.getPublisherTier("abc.es")).toBe("reliable_secondary");
  });
});
