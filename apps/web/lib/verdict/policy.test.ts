import { describe, expect, it } from "vitest";
import type { ParsedClef } from "@/lib/clef/client";
import type { CorpusEntry } from "@/lib/fixtures";
import type { EvidenceCandidate } from "@/lib/types";
import { applyVerdictPolicy, simulatedVerdict } from "@/lib/verdict/policy";

function clef(overrides: Partial<ParsedClef> = {}): ParsedClef {
  return {
    verdict: "supported",
    verdictProbabilities: {
      supported: 0.8,
      contradicted: 0.05,
      misleading: 0.05,
      unverifiable: 0.1,
    },
    verdictConfidence: 0.8,
    checkableProbability: 0.9,
    evidenceQualityScore: 3,
    needsMoreSourcesProbability: 0.1,
      settleableProbability: 0.9,
    usage: null,
    raw: {},
    ...overrides,
  } as unknown as ParsedClef;
}

function evidence(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  const url = overrides.url ?? "https://example.org/fuente";
  return {
    url,
    title: "Fuente de prueba",
    publisher: `Medio ${url}`,
    publishedAt: "2026-01-01",
    excerpt: "Extracto de prueba",
    sourceTier: "reliable_secondary",
    stance: "supports",
    connector: "test",
    ...overrides,
  };
}

function corpusEntry(overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    id: "test-entry",
    claim: "La Tierra tiene una circunferencia de 400.000 kilómetros",
    aliases: [],
    keywords: ["tierra", "circunferencia"],
    expectedVerdict: "contradicted",
    rationale: "La circunferencia real ronda los 40.000 km.",
    evidence: [],
    ...overrides,
  };
}

describe("applyVerdictPolicy", () => {
  it("forces unverifiable/provisional when the claim is barely checkable", () => {
    const result = applyVerdictPolicy({
      clef: clef({ checkableProbability: 0.3, verdictConfidence: 0.9 }),
      evidence: [evidence(), evidence({ url: "https://example.org/otra" })],
    });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
    expect(result.simulated).toBe(false);
    expect(result.confidence).toBe(0.7);
  });

  it("forces unverifiable/provisional when more sources are needed", () => {
    const result = applyVerdictPolicy({
      clef: clef({ needsMoreSourcesProbability: 0.8 }),
      evidence: [evidence(), evidence({ url: "https://example.org/otra" })],
    });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
    expect(result.confidence).toBe(0.56);
  });

  it("forces unverifiable/provisional with fewer than two evidence items", () => {
    const result = applyVerdictPolicy({
      clef: clef(),
      evidence: [evidence()],
    });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
    expect(result.confidence).toBe(0.53);
    expect(result.evidenceQualityScore).toBe(3);
  });

  it("forces unverifiable/provisional when two pages come from the same outlet", () => {
    const result = applyVerdictPolicy({
      clef: clef(),
      evidence: [
        evidence({ url: "https://es.wikipedia.org/wiki/Tierra", publisher: "Wikipedia en español" }),
        evidence({ url: "https://es.wikipedia.org/wiki/Radio", publisher: "Wikipedia en español" }),
      ],
    });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
    expect(result.rationale).toContain("1 medio(s)");
  });

  it("preserves a strong supported verdict with a capped, non-provisional confidence", () => {
    const result = applyVerdictPolicy({
      clef: clef({ verdictConfidence: 0.99, evidenceQualityScore: 4 }),
      evidence: [
        evidence({ sourceTier: "primary" }),
        evidence({ url: "https://example.org/b" }),
        evidence({ url: "https://example.org/c" }),
      ],
    });

    expect(result.verdict).toBe("supported");
    expect(result.provisional).toBe(false);
    expect(result.simulated).toBe(false);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
    expect(result.confidence).toBe(0.95);
  });

  it("overrides a supported verdict to contradicted when a contradicts-stance excerpt conflicts numerically", () => {
    const result = applyVerdictPolicy({
      clef: clef(),
      evidence: [
        evidence({
          url: "https://science.nasa.gov/tierra/circunferencia",
          publisher: "NASA",
          sourceTier: "primary",
          stance: "contradicts",
          excerpt: "La circunferencia ecuatorial de la Tierra es de 40.075 kilómetros.",
        }),
        evidence({ url: "https://example.org/otra" }),
      ],
      claimText: "La Tierra tiene una circunferencia de cuatrocientos mil kilómetros",
      checkability: "likely_fact",
      evidenceCount: 2,
    });

    expect(result.verdict).toBe("contradicted");
    expect(result.confidence).toBe(0.82);
    expect(result.provisional).toBe(true);
    expect(result.rationale).toContain("verificación numérica: 400000 vs 40075");
  });

  it("keeps the insufficient-evidence verdict when one numeric source conflicts", () => {
    const result = applyVerdictPolicy({
      clef: clef(),
      evidence: [
        evidence({
          stance: "contradicts",
          excerpt: "La circunferencia ecuatorial es de 40.075 kilómetros.",
        }),
      ],
      claimText: "La circunferencia es de 400.000 kilómetros",
      checkability: "likely_fact",
    });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
  });
});

describe("simulatedVerdict", () => {
  it("uses the curated corpus verdict without calling Clef", () => {
    const result = simulatedVerdict({ evidence: [], corpusEntry: corpusEntry() });

    expect(result.verdict).toBe("contradicted");
    expect(result.confidence).toBe(0.72);
    expect(result.provisional).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.mode).toBe("simulated");
  });

  it("returns misleading when retrieved sources disagree", () => {
    const result = simulatedVerdict({
      evidence: [
        evidence({ stance: "supports" }),
        evidence({ url: "https://example.org/b", stance: "contradicts" }),
      ],
      corpusEntry: null,
    });

    expect(result.verdict).toBe("misleading");
    expect(result.confidence).toBe(0.5);
    expect(result.simulated).toBe(true);
  });

  it("stays unverifiable/provisional when there is not enough evidence", () => {
    const result = simulatedVerdict({ evidence: [evidence()], corpusEntry: null });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
    expect(result.simulated).toBe(true);
  });
});

describe("fuentes sin contrastar", () => {
  function clef(overrides: Partial<ParsedClef> = {}): ParsedClef {
    return {
      verdict: "supported",
      verdictProbabilities: { supported: 0.9 },
      verdictConfidence: 0.9,
      checkableProbability: 0.9,
      evidenceQualityScore: 3,
      needsMoreSourcesProbability: 0.2,
      settleableProbability: 0.9,
      usage: undefined,
      raw: {},
      ...overrides,
    };
  }

  function source(url: string, sourceTier: EvidenceCandidate["sourceTier"]): EvidenceCandidate {
    return {
      url,
      title: "Trabajar en la construcción en Suiza",
      publisher: new URL(url).hostname,
      publishedAt: null,
      excerpt: "Un texto suficientemente largo sobre trabajar en la construcción en Suiza.",
      sourceTier,
      stance: "supports",
      connector: "websearch:searxng",
    };
  }

  it("never calls a verdict firm when every source is an unvetted site", () => {
    // Measured: three SEO blogs produced "respaldada" at 0.85 with no caveat.
    const decision = applyVerdictPolicy({
      clef: clef(),
      evidence: [
        source("https://suizaespanol.com/a", "other"),
        source("https://mevoyalmundo.com/b", "other"),
        source("https://diarium.usal.es/c", "other"),
      ],
      claimText: "Los españoles trabajan como encofradores en Suiza.",
      checkability: "likely_fact",
    });

    expect(decision.provisional).toBe(true);
    expect(decision.confidence).toBeLessThanOrEqual(0.6);
    expect(decision.summary).toContain("provisional");
  });

  it("keeps a firm verdict when a recognised outlet is among the sources", () => {
    const decision = applyVerdictPolicy({
      clef: clef(),
      evidence: [
        source("https://www.abc.es/a", "reliable_secondary"),
        source("https://mevoyalmundo.com/b", "other"),
      ],
      claimText: "Hay españoles que se van a trabajar a Suiza.",
      checkability: "likely_fact",
    });

    expect(decision.provisional).toBe(false);
  });
});

describe("afirmaciones vagas", () => {
  function clefStrong(): ParsedClef {
    return {
      verdict: "supported",
      verdictProbabilities: { supported: 0.95 },
      verdictConfidence: 0.95,
      checkableProbability: 0.9,
      evidenceQualityScore: 3,
      needsMoreSourcesProbability: 0.2,
      settleableProbability: 0.9,
      usage: undefined,
      raw: {},
    };
  }

  function press(url: string): EvidenceCandidate {
    return {
      url,
      title: "Los servicios públicos en España",
      publisher: new URL(url).hostname,
      publishedAt: null,
      excerpt: "Un análisis amplio sobre la situación de los servicios públicos en España.",
      sourceTier: "reliable_secondary",
      stance: "supports",
      connector: "websearch:searxng",
    };
  }

  // Both were published as firm "respaldada" on real captures.
  it.each([
    "Los servicios públicos empeoran.",
    "Tener un trabajo ya no garantiza llegar a fin de mes.",
  ])("never settles a claim with no figure, date or name: %s", (claimText) => {
    const decision = applyVerdictPolicy({
      clef: clefStrong(),
      evidence: [press("https://www.rtve.es/a"), press("https://elpais.com/b")],
      claimText,
      checkability: "likely_fact",
    });

    expect(decision.provisional).toBe(true);
    expect(decision.confidence).toBeLessThanOrEqual(0.6);
    expect(decision.summary).toContain("no puede darse por zanjada");
  });

  it.each([
    "Cada año se forman algo más de 240.000 familias.",
    "La UCA Hogar Joven permite aportar 2.000 euros anuales con deducciones fiscales.",
  ])("still settles a claim that names something: %s", (claimText) => {
    const decision = applyVerdictPolicy({
      clef: clefStrong(),
      evidence: [press("https://www.rtve.es/a"), press("https://elpais.com/b")],
      claimText,
      checkability: "likely_fact",
    });

    expect(decision.provisional).toBe(false);
  });
});
