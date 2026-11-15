import { describe, expect, it } from "vitest";
import { claimAnchors, mentionsAnchor } from "@/lib/claims/anchors";
import { rankCandidates } from "@/lib/evidence/rank";
import type { EvidenceCandidate } from "@/lib/types";

function source(overrides: Partial<EvidenceCandidate>): EvidenceCandidate {
  return {
    url: "https://example.org/a",
    title: "Título",
    publisher: "Example",
    publishedAt: null,
    excerpt: "Un texto cualquiera sobre el asunto.",
    sourceTier: "other",
    stance: null,
    connector: "websearch:bingnews",
    ...overrides,
  };
}

describe("claimAnchors", () => {
  it("picks out the figures, years and names a claim is about", () => {
    expect(
      claimAnchors("Se invertirán 19.000 millones de euros en las vías entre 2026 y 2030."),
    ).toEqual(expect.arrayContaining(["19000", "2026", "2030"]));
    expect(claimAnchors("El AVE Madrid-Ourense se inauguró con el rey Felipe VI."))
      .toEqual(expect.arrayContaining(["ave", "madrid ourense", "felipe"]));
    expect(claimAnchors("No del PP u otros partidos")).toContain("pp");
  });

  it("ignores the first word and ordinary capitalisation", () => {
    expect(claimAnchors("Los retrasos son habituales.")).toEqual([]);
  });
});

describe("mentionsAnchor", () => {
  it("accepts everything when the claim names nothing specific", () => {
    expect(mentionsAnchor([], source({}))).toBe(true);
  });

  it("rejects a source that shares no figure and no name with the claim", () => {
    // Real case: a vague claim about presenting a law was handed an article
    // about Guatemala reforming twenty laws.
    const anchors = claimAnchors("No del PP u otros partidos, hemos presentado una ley acordada.");
    expect(
      mentionsAnchor(
        anchors,
        source({
          title: "Guatemala debe reformar 20 leyes para cumplir el acuerdo comercial",
          excerpt: "El sector empresarial indica que Guatemala tiene que reformar leyes.",
        }),
      ),
    ).toBe(false);
  });

  it("keeps a source that mentions one of them", () => {
    const anchors = claimAnchors("El AVE Madrid-Ourense costó 9.000 millones.");
    expect(
      mentionsAnchor(anchors, source({ title: "Sánchez inaugura el AVE a Galicia", excerpt: "El AVE une Madrid y Ourense." })),
    ).toBe(true);
  });
});

describe("rankCandidates with anchors", () => {
  it("ranks the source that names the claim's subject above the one that does not", () => {
    const ranked = rankCandidates(
      "El AVE Madrid-Ourense se inauguró en 2021.",
      [
        source({ url: "https://example.org/off", title: "Guatemala reforma sus leyes", excerpt: "El sector pide reformar veinte leyes este año." }),
        source({ url: "https://example.org/on", title: "Inauguración del AVE a Ourense", excerpt: "El AVE Madrid-Ourense entró en servicio en 2021." }),
      ],
      3,
    );

    expect(ranked[0]?.url).toBe("https://example.org/on");
  });

  it("still keeps an unanchored source when it is all there is", () => {
    // Demoting beats discarding: a relevant article often does not repeat the
    // figure inside the short excerpt a news feed provides.
    const ranked = rankCandidates(
      "Se han tardado 15 años en revertir los recortes ferroviarios.",
      [source({ url: "https://example.org/efe", title: "Cuánto destina España a la infraestructura ferroviaria", excerpt: "La inversión es menor que antes de la crisis." })],
      3,
    );

    expect(ranked.map((item) => item.url)).toEqual(["https://example.org/efe"]);
  });
});
