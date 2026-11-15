import { describe, expect, it } from "vitest";
import { checkSuperlative, superlativeMarkers } from "@/lib/verdict/superlative";
import { applyVerdictPolicy } from "@/lib/verdict/policy";
import type { ParsedClef } from "@/lib/clef/client";
import type { EvidenceCandidate } from "@/lib/types";

const CLAIM = "El año pasado España creó quinientos mil empleos, un récord histórico.";

function evidence(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    url: "https://example.org/empleo",
    title: "Empleo en España",
    publisher: "INE",
    publishedAt: null,
    excerpt: "Se crearon 500.000 empleos en el último año.",
    sourceTier: "reliable_secondary",
    stance: "supports",
    connector: "corpus",
    ...overrides,
  };
}

function clef(overrides: Partial<ParsedClef> = {}): ParsedClef {
  return {
    verdict: "supported",
    verdictConfidence: 0.9,
    checkableProbability: 0.9,
    evidenceQualityScore: 3,
    needsMoreSourcesProbability: 0.1,
    verdictProbabilities: { supported: 0.9, contradicted: 0.02, misleading: 0.05, unverifiable: 0.03 },
    usage: null,
    raw: {},
    ...overrides,
  } as unknown as ParsedClef;
}

describe("superlative detection", () => {
  it("finds record wording", () => {
    expect(superlativeMarkers(CLAIM)).toContain("record");
  });

  it("ignores claims without superlatives", () => {
    expect(checkSuperlative("El agua hierve a cien grados.", ["El agua hierve a 100 °C."])).toBe("none");
  });

  it("reports the superlative as unsupported when no source repeats it", () => {
    expect(checkSuperlative(CLAIM, ["Se crearon 500.000 empleos."])).toBe("unsupported");
  });

  it("reports it supported when a source repeats it", () => {
    expect(checkSuperlative(CLAIM, ["España alcanzó un récord histórico de empleo."])).toBe(
      "supported",
    );
  });
});

describe("policy with superlatives", () => {
  it("downgrades supported to misleading when the record is not in the sources", () => {
    const result = applyVerdictPolicy({
      clef: clef(),
      evidence: [evidence(), evidence({ url: "https://example.org/2", publisher: "Wikipedia" })],
      claimText: CLAIM,
      checkability: "likely_fact",
    });

    expect(result.verdict).toBe("misleading");
    expect(result.rationale).toContain("superlativo");
  });

  it("keeps supported when a source covers the record", () => {
    const result = applyVerdictPolicy({
      clef: clef(),
      evidence: [
        evidence({ excerpt: "España cerró el año con un récord histórico de empleo: 500.000 puestos." }),
        evidence({
          url: "https://example.org/2",
          publisher: "Wikipedia",
          excerpt: "El mercado laboral marcó un récord.",
        }),
      ],
      claimText: CLAIM,
      checkability: "likely_fact",
    });

    expect(result.verdict).toBe("supported");
  });
});
