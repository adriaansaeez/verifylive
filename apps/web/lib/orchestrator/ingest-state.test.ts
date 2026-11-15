import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.VERITAS_DB = path.join(os.tmpdir(), `veritas-ingest-${randomUUID()}.sqlite`);
});

describe("ingestSegment session state", () => {
  it("rejects a segment while the session is finishing", async () => {
    const [{ createSession, setSessionStatus, snapshot }, { ingestSegment }] = await Promise.all([
      import("@/lib/db/repo"),
      import("@/lib/orchestrator"),
    ]);
    const id = `ses_${randomUUID()}`;
    createSession({ id, sourceType: "mic" });
    setSessionStatus(id, "finishing");

    await expect(
      ingestSegment({ sessionId: id, text: "Madrid es la capital.", startMs: 0, endMs: 500 }),
    ).resolves.toBeNull();
    expect(snapshot(id)?.segments).toHaveLength(0);
  });
});
