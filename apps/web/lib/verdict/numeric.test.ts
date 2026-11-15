import { describe, expect, it } from "vitest";
import {
  applyNumericCheck,
  numericComparison,
  parseNumbers,
} from "@/lib/verdict/numeric";

const EARTH_CLAIM = "La Tierra tiene una circunferencia de cuatrocientos mil kilómetros";
const EARTH_EXCERPT = "La circunferencia ecuatorial de la Tierra es de 40.075 kilómetros.";
const EVEREST_CLAIM = "El monte Everest mide ocho mil ochocientos cuarenta metros";
const EVEREST_EXCERPT = "El Everest alcanza los 8.848,86 metros de altura.";

describe("parseNumbers", () => {
  it("rewrites Spanish word numbers into digits", () => {
    expect(parseNumbers(EARTH_CLAIM)).toEqual([400000]);
    expect(parseNumbers(EVEREST_CLAIM)).toEqual([8840]);
  });

  it("parses Spanish thousands dot and decimal comma", () => {
    expect(parseNumbers(EARTH_EXCERPT)).toEqual([40075]);
    expect(parseNumbers(EVEREST_EXCERPT)).toEqual([8848.86]);
  });

  it("parses percentages and plain integers", () => {
    expect(parseNumbers("27 % de la población")).toEqual([27]);
    expect(parseNumbers("400000")).toEqual([400000]);
  });

  it("ignores single-digit tokens", () => {
    expect(parseNumbers("hay 3 casos")).toEqual([]);
  });
});

describe("numericComparison", () => {
  it("flags the Earth claim as a conflict", () => {
    expect(numericComparison(parseNumbers(EARTH_CLAIM), parseNumbers(EARTH_EXCERPT))).toBe("conflict");
  });

  it("treats the Everest rounding difference as consistent", () => {
    expect(numericComparison(parseNumbers(EVEREST_CLAIM), parseNumbers(EVEREST_EXCERPT))).toBe("consistent");
  });

  it("treats equal values as consistent", () => {
    expect(numericComparison([100], [100])).toBe("consistent");
  });

  it("does not let one coincidental match hide another conflicting figure", () => {
    expect(numericComparison([2024, 20], [2024, 25])).toBe("conflict");
  });

  it("returns none when a side has no numbers", () => {
    expect(numericComparison([], [100])).toBe("none");
    expect(numericComparison([100], [])).toBe("none");
  });
});

function check(overrides: Partial<Parameters<typeof applyNumericCheck>[0]> = {}) {
  return applyNumericCheck({
    verdict: "supported",
    confidence: 0.8,
    provisional: false,
    rationale: "Clef evaluó 2 fuente(s).",
    claimText: EARTH_CLAIM,
    checkability: "likely_fact",
    evidence: [
      { stance: "contradicts", excerpt: EARTH_EXCERPT, sourceKey: "source-a" },
      { stance: "contradicts", excerpt: EARTH_EXCERPT, sourceKey: "source-b" },
    ],
    evidenceCount: 2,
    distinctSourceCount: 2,
    ...overrides,
  });
}

describe("applyNumericCheck", () => {
  it("overrides a supported verdict to contradicted on a numeric conflict", () => {
    const result = check();

    expect(result.verdict).toBe("contradicted");
    expect(result.confidence).toBe(0.82);
    expect(result.provisional).toBe(false);
    expect(result.rationale).toContain("verificación numérica: 400000 vs 40075");
  });

  it("does not let a matching year hide a conflicting percentage", () => {
    const result = check({
      claimText: "En 2024 la tasa alcanzó el 20%",
      evidence: [
        { stance: "contradicts", excerpt: "En 2024 la tasa fue del 25%.", sourceKey: "source-a" },
        { stance: "contradicts", excerpt: "La tasa registrada en 2024 fue del 25%.", sourceKey: "source-b" },
      ],
    });

    expect(result.verdict).toBe("contradicted");
    expect(result.rationale).toContain("verificación numérica: 20 vs 25");
  });

  it("does not bypass source diversity with a single outlet", () => {
    const result = check({
      verdict: "unverifiable",
      provisional: true,
      evidenceCount: 1,
      distinctSourceCount: 1,
    });

    expect(result.verdict).toBe("unverifiable");
    expect(result.provisional).toBe(true);
    expect(result.rationale).toBe("Clef evaluó 2 fuente(s).");
  });

  it("keeps a one-outlet numeric override provisional", () => {
    const result = check({
      evidence: [
        { stance: "contradicts", excerpt: EARTH_EXCERPT, sourceKey: "same-outlet" },
        { stance: "contradicts", excerpt: EARTH_EXCERPT, sourceKey: "same-outlet" },
      ],
    });

    expect(result.verdict).toBe("contradicted");
    expect(result.provisional).toBe(true);
  });

  it("rescues a contradicted verdict when the gap is only rounding", () => {
    const result = check({
      verdict: "contradicted",
      confidence: 0.789,
      provisional: true,
      claimText: EVEREST_CLAIM,
      evidence: [{ stance: "contradicts", excerpt: EVEREST_EXCERPT }],
    });

    expect(result.verdict).toBe("supported");
    expect(result.confidence).toBe(0.8);
    expect(result.provisional).toBe(true);
    expect(result.rationale).toContain("verificación numérica: 8840 vs 8848.86");
  });

  it("upgrades unverifiable to supported when a supporting source matches the number", () => {
    const result = check({
      verdict: "unverifiable",
      confidence: 0.511,
      provisional: true,
      claimText: EVEREST_CLAIM,
      evidence: [{ stance: "supports", excerpt: EVEREST_EXCERPT }],
    });

    expect(result.verdict).toBe("supported");
    expect(result.confidence).toBe(0.8);
    expect(result.provisional).toBe(true);
    expect(result.rationale).toContain("verificación numérica: 8840 vs 8848.86");
  });

  it("does not upgrade when any evidence conflicts", () => {
    const result = check({
      verdict: "unverifiable",
      claimText: EVEREST_CLAIM,
      evidence: [
        { stance: "supports", excerpt: EVEREST_EXCERPT },
        { stance: "context", excerpt: "Otra fuente dice 4.000 metros." },
      ],
    });

    expect(result.verdict).toBe("unverifiable");
  });

  it("skips opinions", () => {
    const result = check({ checkability: "likely_opinion" });

    expect(result.verdict).toBe("supported");
    expect(result.confidence).toBe(0.8);
    expect(result.rationale).toBe("Clef evaluó 2 fuente(s).");
  });

  it("leaves the input untouched when the evidence has no numbers", () => {
    const result = check({ evidence: [{ stance: "contradicts", excerpt: "Sin cifras." }] });

    expect(result.verdict).toBe("supported");
    expect(result.rationale).toBe("Clef evaluó 2 fuente(s).");
  });
});
