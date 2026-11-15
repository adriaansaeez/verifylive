import { normalizeText } from "@/lib/text";

type Word = { raw: string; normalized: string; start: number; end: number };

/** Words compared per junction. Two ASR windows overlap by seconds, not more. */
const MAX_OVERLAP_WORDS = 20;

/** How much of the overlap must line up for it to count as the same speech. */
const MIN_OVERLAP_SIMILARITY = 0.6;

function words(value: string): Word[] {
  const output: Word[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}%]+/gu)) {
    const raw = match[0];
    const start = match.index ?? 0;
    output.push({ raw, normalized: normalizeText(raw), start, end: start + raw.length });
  }
  return output;
}

/**
 * ASR re-decodes a word's ending more often than its stem: "controles" comes
 * back as "controladores", "averías" as "averiguas". Two words count as the
 * same when they share a long stem, which is what lets the junction align at
 * all in those cases.
 */
function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const shortest = Math.min(left.length, right.length);
  if (shortest < 6) return false;
  let shared = 0;
  while (shared < shortest && left[shared] === right[shared]) shared += 1;
  return shared >= 5;
}

/** Length of the longest common subsequence of two short word sequences. */
function commonLength(left: string[], right: string[]): number {
  const columns = right.length + 1;
  let previousRow = new Uint8Array(columns);
  let row = new Uint8Array(columns);
  for (let index = 1; index <= left.length; index += 1) {
    for (let column = 1; column < columns; column += 1) {
      row[column] = sameWord(left[index - 1] ?? "", right[column - 1] ?? "")
        ? (previousRow[column - 1] ?? 0) + 1
        : Math.max(previousRow[column] ?? 0, row[column - 1] ?? 0);
    }
    const swap = previousRow;
    previousRow = row;
    row = swap;
    row.fill(0);
  }
  return previousRow[columns - 1] ?? 0;
}

/**
 * Returns only the new suffix from two overlapping ASR transcriptions.
 *
 * Exact equality on the overlap is not enough: the model re-decodes the shared
 * audio differently every time. In the captured interview, "mayores tiempos de
 * descanso, también para los controles" came back as "De descanso, también para
 * los controladores", so no exact match existed and the whole window was
 * re-emitted; seven of fifty-six segments duplicated their predecessor's tail
 * that way.
 *
 * The two sides are therefore aligned with independent lengths, because a
 * re-decode inserts and drops words, and scored with a Dice coefficient over
 * the longest common subsequence. Dice penalises leftover words on BOTH sides,
 * which is what stops a long sloppy alignment from beating the real overlap and
 * swallowing words the speaker actually said. The best-scoring alignment wins
 * rather than the first acceptable one, so when in doubt the result keeps a
 * duplicated word instead of deleting real speech.
 */
export function transcriptDelta(previous: string, current: string): string {
  const before = words(previous);
  const after = words(current);
  if (before.length === 0 || after.length === 0) return current.trim();

  const leftMax = Math.min(before.length, MAX_OVERLAP_WORDS);
  const rightMax = Math.min(after.length, MAX_OVERLAP_WORDS);
  const tail = before.slice(-leftMax).map((word) => word.normalized);
  const head = after.slice(0, rightMax).map((word) => word.normalized);

  // Anchoring. A re-decoded window starts by repeating audio, so its first
  // word must line up with something in the previous tail, and the previous
  // tail's last word must line up with something in the new window. Natural
  // speech that repeats a phrase looks exactly like an overlap otherwise: in
  // "el AVE Madrid-Ourense, el AVE Madrid-Murcia" the junction matched "el ave
  // madrid" and the merge deleted the word "Ourense", which the speaker
  // actually said. Losing real speech is far worse than leaving a repetition,
  // so an unanchored alignment is refused outright.
  const headAnchored = commonLength(tail, head.slice(0, 1)) === 1;
  const tailAnchored = commonLength(tail.slice(-1), head) === 1;
  if (!headAnchored || !tailAnchored) return current.trim();

  // The alignment that explains the most repeated speech wins, and the Dice
  // similarity gate keeps a sloppy long alignment from qualifying at all.
  let best = { matched: 0, similarity: 0, consumed: 0 };
  for (let left = 2; left <= leftMax; left += 1) {
    for (let right = 2; right <= rightMax; right += 1) {
      const matched = commonLength(tail.slice(leftMax - left), head.slice(0, right));
      if (matched === 0) continue;
      const similarity = (2 * matched) / (left + right);
      if (similarity < MIN_OVERLAP_SIMILARITY) continue;
      const better =
        matched > best.matched ||
        (matched === best.matched && similarity > best.similarity) ||
        (matched === best.matched && similarity === best.similarity && right > best.consumed);
      if (better) best = { matched, similarity, consumed: right };
    }
  }

  if (best.consumed === 0) return current.trim();
  const firstNew = after[best.consumed];
  if (!firstNew) return "";
  return current.slice(firstNew.start).replace(/^[\s,.;:!?—-]+/u, "").trim();
}
