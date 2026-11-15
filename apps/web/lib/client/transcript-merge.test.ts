import { describe, expect, it } from "vitest";
import { transcriptDelta } from "@/lib/client/transcript-merge";

describe("transcriptDelta", () => {
  it("keeps only the new words from overlapping ASR windows", () => {
    expect(
      transcriptDelta(
        "Nosotros hemos multiplicado por veinte la inversión",
        "por veinte la inversión durante estos últimos ocho años.",
      ),
    ).toBe("durante estos últimos ocho años.");
  });

  it("tolerates punctuation and capitalization changes in the overlap", () => {
    expect(transcriptDelta("Las averías son algo habitual.", "algo habitual, los retrasos también."))
      .toBe("los retrasos también.");
  });

  it("returns the full text when no reliable overlap exists", () => {
    expect(transcriptDelta("Una frase anterior.", "Un asunto completamente distinto."))
      .toBe("Un asunto completamente distinto.");
  });

  it("never deletes a word the speaker said when a phrase repeats naturally", () => {
    // "el AVE Madrid-Ourense, el AVE Madrid-Murcia": the junction looks like an
    // overlap, but "Ourense" is new speech.
    expect(
      transcriptDelta(
        "la línea de alta velocidad. Yo he inaugurado pues el ave madrid",
        "Ourense el ave madrid murcia bueno y tres el mantenimiento",
      ),
    ).toContain("Ourense");
  });

  // Captured from the rail interview: Parakeet re-decoded the shared audio
  // differently on each window, so exact matching duplicated the tail.
  it.each([
    [
      "la seguridad social, mayores tiempos de descanso, también para los controles.",
      "De descanso, también para los controladores del centro de operaciones que hay en Atocha.",
      "del centro de operaciones que hay en Atocha.",
    ],
    [
      "invertir diecinueve cero millones de euros en el mantenimiento y la seguridad de las vías ferroviarias, ¿no? Por tanto.",
      "De las vías ferroviarias. Por tanto, es evidente que tenemos que hacer más.",
      "es evidente que tenemos que hacer más.",
    ],
    [
      "Que haya habido más incidencias, eso ha implicado también que haya habido más averiguas.",
      "Que haya habido, bueno, pues más averías que nos han llevado a esta situación.",
      "que nos han llevado a esta situación.",
    ],
  ])("drops the re-decoded overlap (%#)", (previous, current, expected) => {
    expect(transcriptDelta(previous, current)).toBe(expected);
  });
});
