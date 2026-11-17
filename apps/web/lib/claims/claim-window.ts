export type ClaimWindowPart = {
  text: string;
  startMs: number;
  endMs: number;
};

export type ClaimCandidate = ClaimWindowPart & {
  id: string;
  partCount: number;
  endPartId: number;
};

/** Longest span offered to the gate, in parts. Bounds the questions per call. */
const MAX_SPAN_PARTS = 4;

const SENTENCE_END = /[.!?…]["'»”)]?\s*$/u;

/**
 * Rolling transcript window used to recover claims split by arbitrary ASR
 * boundaries. Candidates are exact spans of what was said: the gate may choose
 * a boundary, but it never generates or rewrites the speaker's words.
 *
 * Spans end either at the newest part or at a part that closes a sentence, so
 * a claim completed mid-window is still reachable once filler follows it.
 *
 * Un tramo que acaba en la parte más reciente SIN cerrar frase se está
 * juzgando antes de que el hablante termine, y así se publicaba «Yo he
 * inaugurado pues el ave madrid» como afirmación, dejando «Ourense el ave
 * madrid murcia» para otra ficha. Esos tramos esperan al siguiente segmento,
 * salvo que ya no puedan crecer más: entonces hay que juzgarlos igual.
 */
export class ClaimWindow {
  private parts: Array<ClaimWindowPart & { partId: number }> = [];
  private nextPartId = 0;

  /** Nunca mayor que la ventana: si no, el escape de abajo es inalcanzable. */
  private readonly maxSpan: number;

  constructor(private readonly maxParts = 6) {
    this.maxSpan = Math.min(MAX_SPAN_PARTS, maxParts);
  }

  append(input: ClaimWindowPart): ClaimCandidate[] {
    const text = input.text.replace(/\s+/g, " ").trim();
    if (!text) return this.candidates();
    this.parts.push({ ...input, text, partId: this.nextPartId++ });
    while (this.parts.length > this.maxParts) this.parts.shift();
    return this.candidates();
  }

  private endIndexes(): number[] {
    const last = this.parts.length - 1;
    if (last < 0) return [];
    const ends = new Set<number>([last]);
    for (let index = 0; index < last; index += 1) {
      if (SENTENCE_END.test(this.parts[index]?.text ?? "")) ends.add(index);
    }
    return [...ends].sort((left, right) => left - right);
  }

  candidates(): ClaimCandidate[] {
    const output: ClaimCandidate[] = [];
    const seen = new Set<string>();
    const newest = this.parts.length - 1;
    for (const end of this.endIndexes()) {
      const openEnd = end === newest && !SENTENCE_END.test(this.parts[end]?.text ?? "");
      const lowest = Math.max(0, end - (this.maxSpan - 1));
      for (let start = end; start >= lowest; start -= 1) {
        const selected = this.parts.slice(start, end + 1);
        const first = selected[0];
        const last = selected.at(-1);
        if (!first || !last) continue;
        // Aún puede crecer con el segmento siguiente: no lo juzgues todavía.
        if (openEnd && selected.length < this.maxSpan) continue;
        const text = selected.map((part) => part.text).join(" ");
        if (seen.has(text)) continue;
        seen.add(text);
        output.push({
          id: `span_${first.partId}_${last.partId}`,
          partCount: selected.length,
          endPartId: last.partId,
          text,
          startMs: first.startMs,
          endMs: last.endMs,
        });
      }
    }
    return output;
  }

  consume(candidate?: ClaimCandidate): void {
    if (!candidate) {
      this.parts = [];
      return;
    }
    const end = this.parts.findIndex((part) => part.partId === candidate.endPartId);
    if (end >= 0) this.parts.splice(0, end + 1);
  }

  clear(): void {
    this.parts = [];
  }
}
