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
