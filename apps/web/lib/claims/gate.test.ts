import { describe, expect, it } from "vitest";
import type { ClaimCandidate } from "@/lib/claims/claim-window";
import {
  buildGateQuestions,
  gateCandidates,
  passesGate,
  scoreGate,
  selectGated,
} from "@/lib/claims/gate";

function candidate(id: string, text: string, partCount = 1): ClaimCandidate {
  return { id, text, partCount, endPartId: partCount, startMs: 0, endMs: 1_000 };
}

describe("gateCandidates", () => {
  it("spends no Clef call on speech acts or scraps", () => {
    const kept = gateCandidates([
      candidate("a", "Hablemos de los accidentes que han sucedido."),
      candidate("b", "¿Por qué no hay ya una dimisión?"),
      candidate("c", "Sí, claro."),
      candidate("d", "La inversión se multiplicó por veinte en ocho años."),
    ]);

    expect(kept.map((entry) => entry.id)).toEqual(["d"]);
  });
});

describe("buildGateQuestions", () => {
  it("asks completeness and factuality separately for each span", () => {
    const questions = buildGateQuestions([candidate("span_0_0", "Una afirmación cualquiera.")]);
    expect(Object.keys(questions)).toEqual(["span_0_0__closed", "span_0_0__factual"]);
    expect(questions.span_0_0__closed?.instructions).toContain("juzga solo el final");
    expect(questions.span_0_0__factual?.instructions).toContain("Ignora muletillas");
  });
});

describe("scoreGate", () => {
  it("multiplies the two probabilities and tolerates a missing answer", () => {
    const scores = scoreGate(
      [candidate("span_0_0", "Un hecho."), candidate("span_1_1", "Otro hecho.")],
      { span_0_0__closed: { noul: 0.8 }, span_0_0__factual: { noul: 0.5 } },
    );

    expect(scores[0]).toMatchObject({ closed: 0.8, factual: 0.5 });
    expect(scores[0]?.score).toBeCloseTo(0.4);
    expect(scores[1]).toMatchObject({ closed: 0, factual: 0, score: 0 });
  });
});

describe("passesGate", () => {
  // Numbers measured on the captured interview.
  it("rejects a span cut before the idea ends", () => {
    // "Yo he inaugurado pues el ave madrid"
    expect(passesGate({ candidate: candidate("a", "x"), closed: 0.03, factual: 0.7, score: 0.021 }))
      .toBe(false);
  });

  it("rejects a question that is grammatically complete", () => {
    expect(passesGate({ candidate: candidate("a", "x"), closed: 0.98, factual: 0.06, score: 0.059 }))
      .toBe(false);
  });

  it("accepts a finished, checkable assertion", () => {
    expect(passesGate({ candidate: candidate("a", "x"), closed: 0.91, factual: 0.94, score: 0.855 }))
      .toBe(true);
  });
});

describe("selectGated", () => {
  it("prefers the span with more context when the scores are close", () => {
    // The old scoring added at most 0.06 for extra parts, so the short
    // truncated span won; the complete sentence must win instead.
    const chosen = selectGated([
      { candidate: candidate("short", "el ave madrid", 1), closed: 0.9, factual: 0.95, score: 0.855 },
      {
        candidate: candidate("long", "Yo he inaugurado el ave madrid Ourense y el ave madrid murcia.", 2),
        closed: 0.88,
        factual: 0.85,
        score: 0.748,
      },
    ]);

    expect(chosen?.candidate.id).toBe("long");
  });

  it("keeps the better span when the gap is decisive", () => {
    const chosen = selectGated([
      { candidate: candidate("clean", "a", 1), closed: 0.95, factual: 0.95, score: 0.9 },
      { candidate: candidate("muddy", "b", 3), closed: 0.6, factual: 0.5, score: 0.3 },
    ]);

    expect(chosen?.candidate.id).toBe("clean");
  });

  it("publishes nothing when no span qualifies", () => {
    expect(
      selectGated([
        { candidate: candidate("a", "x", 1), closed: 0.2, factual: 0.9, score: 0.18 },
      ]),
    ).toBeNull();
  });
});
