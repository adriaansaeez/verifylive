import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceCandidate } from "@/lib/types";
import { rankAndRerankCandidates } from "./rank";

function candidate(overrides: Partial<EvidenceCandidate>): EvidenceCandidate {
  return {
    url: "https://example.org/source",
    title: "Fuente",
    publisher: "Example",
    publishedAt: null,
    excerpt: "Contenido relevante sobre empleo y economía.",
    sourceTier: "other",
    stance: null,
    connector: "test",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rankAndRerankCandidates", () => {
  it("preserves the NaN rerank as the final returned order", async () => {
    vi.stubEnv("NAN_RERANK_URL", "https://rerank.example.test");
    vi.stubEnv("NAN_RERANK_MODEL", "test-reranker");
    vi.stubEnv("NAN_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [
        { index: 0, relevance_score: 0.42 },
        { index: 1, relevance_score: 0.99 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const locallyStrong = candidate({
      url: "https://nasa.gov/jobs",
      title: "Empleo y economía",
      publisher: "NASA",
      sourceTier: "primary",
    });
    const remotelyPreferred = candidate({
      url: "https://example.net/report",
      title: "Informe alternativo",
      publisher: "Example.net",
    });

    const result = await rankAndRerankCandidates(
      "empleo economía",
      [locallyStrong, remotelyPreferred],
      2,
    );

    expect(result.candidates.map((item) => item.url)).toEqual([
      "https://example.net/report",
      "https://nasa.gov/jobs",
    ]);
    expect(result.dropped).toBe(0);
  });

  it("drops a source the reranker finds barely related, and says how many", async () => {
    vi.stubEnv("NAN_RERANK_URL", "https://rerank.example.test");
    vi.stubEnv("NAN_RERANK_MODEL", "test-reranker");
    vi.stubEnv("NAN_KEY", "test-key");
    // What the real reranker said about "Historia del ferrocarril en España"
    // as evidence for a claim about which regions want more high speed line.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [
        { index: 0, relevance_score: 0.9 },
        { index: 1, relevance_score: 0.04 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const result = await rankAndRerankCandidates(
      "empleo economía",
      [
        candidate({ url: "https://example.net/relevant", title: "Informe de empleo" }),
        candidate({ url: "https://example.net/topical", title: "Historia general" }),
      ],
      3,
    );

    expect(result.candidates.map((item) => item.url)).toEqual(["https://example.net/relevant"]);
    expect(result.dropped).toBe(1);
  });
});
