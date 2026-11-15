import { describe, expect, it } from "vitest";
import { buildQueries, classifyCheckability, extractHeuristicClaims, isSpeechAct, stripMetaPrefix } from "@/lib/claims/heuristic";

const SOLAR_CLAIM = "El precio de la energía solar cayó un 89% en una década.";

describe("stripMetaPrefix", () => {
  it("removes the lead-in before the real assertion", () => {
    expect(
      stripMetaPrefix("Quiero empezar con un dato que resume la situación: Madrid es la capital de España."),
    ).toBe("Madrid es la capital de España.");
  });

  it("keeps the fact after a phatic opener", () => {
    expect(stripMetaPrefix("Como todos saben, el agua hierve a cien grados Celsius.")).toBe(
      "el agua hierve a cien grados Celsius.",
    );
  });

  it("leaves plain sentences untouched", () => {
    expect(stripMetaPrefix(SOLAR_CLAIM)).toBe(SOLAR_CLAIM);
  });

  it("keeps the fact after the lead-in when extracting", () => {
    const claims = extractHeuristicClaims({
      text: "Quiero empezar con un dato que resume la situación: Madrid es la capital de España.",
      startMs: 0,
      endMs: 5000,
    });

    expect(claims).toHaveLength(1);
    expect(claims[0]?.text).toBe("Madrid es la capital de España.");
    expect(claims[0]?.checkability).toBe("likely_fact");
  });
});

describe("classifyCheckability", () => {
  it("labels a sentence with a hard number as a likely fact", () => {
    expect(classifyCheckability(SOLAR_CLAIM)).toBe("likely_fact");
  });

  it("labels an opinion as likely_opinion instead of dropping it", () => {
    expect(classifyCheckability("Creo que deberíamos invertir más en energía solar.")).toBe(
      "likely_opinion",
    );
  });

  it("labels a question as unclear", () => {
    expect(classifyCheckability("¿Cuánto cuesta?")).toBe("unclear");
  });

  it("recognizes spoken causal and weather assertions", () => {
    const examples = [
      "La inmigración en España causa muchos problemas como la violencia en la calle.",
      "En España llueve casi todos los días.",
      "Hace frío todos los días en España.",
      "La inmigración hace que suba la criminalidad.",
    ];
    for (const example of examples) expect(classifyCheckability(example)).toBe("likely_fact");
  });

  it("does not turn a one-word ASR fragment into a claim", () => {
    expect(classifyCheckability("Prince.")).toBe("unclear");
    expect(extractHeuristicClaims({ text: "Prince.", startMs: 0, endMs: 1000 })).toEqual([]);
  });
});

describe("buildQueries", () => {
  it("returns at least one non-empty query for a factual claim", () => {
    const queries = buildQueries(SOLAR_CLAIM);
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries[0]).toContain("precio");
    expect(queries.every((query) => query.trim().length > 0)).toBe(true);
  });
});

describe("extractHeuristicClaims", () => {
  it("extracts the solar-price claim and preserves its segment span", () => {
    const claims = extractHeuristicClaims({
      text: SOLAR_CLAIM,
      startMs: 1_000,
      endMs: 4_000,
    });

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      text: SOLAR_CLAIM,
      checkability: "likely_fact",
      startMs: 1_000,
      endMs: 4_000,
    });
    expect(claims[0]!.searchQueries.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps an opinion labelled as likely_opinion", () => {
    const claims = extractHeuristicClaims({
      text: "Creo que deberíamos invertir más en energía solar.",
      startMs: 0,
      endMs: 2_000,
    });

    expect(claims).toHaveLength(1);
    expect(claims[0]!.checkability).toBe("likely_opinion");
    expect(claims[0]!.text).toContain("Creo que");
  });

  it("drops a question", () => {
    expect(
      extractHeuristicClaims({ text: "¿Cuánto cuesta?", startMs: 0, endMs: 1_000 }),
    ).toEqual([]);
  });

  it("returns an empty list for an empty segment", () => {
    expect(extractHeuristicClaims({ text: "", startMs: 0, endMs: 0 })).toEqual([]);
  });

  it("deduplicates the same claim repeated in one segment", () => {
    const claims = extractHeuristicClaims({
      text: `${SOLAR_CLAIM} ${SOLAR_CLAIM}`,
      startMs: 0,
      endMs: 5_000,
    });

    expect(claims).toHaveLength(1);
  });
});

describe("isSpeechAct", () => {
  it("rejects questions, greetings and proposals", () => {
    expect(isSpeechAct("¿Por qué no hay ya una dimisión o un cese?")).toBe(true);
    expect(isSpeechAct("Hablemos de los accidentes que han sucedido.")).toBe(true);
    expect(isSpeechAct("Hola, buenas tardes")).toBe(true);
    expect(isSpeechAct("Fíjate que, por ejemplo")).toBe(true);
  });

  it("keeps a claim that ends in a spoken tag question", () => {
    expect(
      isSpeechAct("vamos a invertir diecinueve cero millones de euros en el mantenimiento de las vías ferroviarias, ¿no?"),
    ).toBe(false);
    expect(isSpeechAct("La inversión se multiplicó por veinte, ¿verdad?")).toBe(false);
  });
});
