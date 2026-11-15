import type { EvidenceCandidate } from "@/lib/types";
import { normalizeText } from "@/lib/text";

/**
 * What a claim is concretely about: its figures, its dates and its names.
 *
 * Two things depend on this. A source that mentions none of a claim's anchors
 * is almost certainly about something else, and a claim with no anchors at all
 * ("los servicios públicos empeoran") is too vague to be verified, so it must
 * never be presented as a settled verdict.
 */

const NUMERIC = /\b\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?\b/gu;

export function numbersOf(text: string): string[] {
  return (text.match(NUMERIC) ?? [])
    .map((value) => value.replace(/[.\s](?=\d{3}\b)/gu, "").replace(",", "."))
    .filter((value) => value.length > 0);
}

/** Words that start a sentence or are capitalised by convention, not by being
 * a name. */
const NOT_A_NAME = new Set([
  "el", "la", "los", "las", "un", "una", "no", "se", "en", "de", "del", "al",
  "y", "o", "que", "es", "son", "fue", "fueron", "ha", "han", "hemos", "he",
  "esta", "este", "estos", "estas", "esto", "eso", "por", "para", "con", "sin",
  "su", "sus", "mi", "me", "le", "les", "lo", "ya", "pero", "como", "cuando",
  "donde", "desde", "hasta", "sobre", "entre", "yo", "tu", "usted", "ustedes",
  "nosotros", "tambien", "solo", "mas", "menos", "muy", "todo", "todos",
]);

/**
 * The specific things a claim is about: figures, years, and names. A claim
 * with anchors can only be answered by a source that mentions at least one of
 * them. Without this, "hemos presentado una ley acordada con el sector"
 * searched for "ley presentada acordada sector" and was handed articles about
 * Guatemala reforming twenty laws and about Andalusia's third sector.
 */
export function claimAnchors(text: string): string[] {
  const anchors = new Set<string>();
  for (const value of numbersOf(text)) anchors.add(value);
  for (const year of text.match(/\b(?:19|20)\d{2}\b/gu) ?? []) anchors.add(year);
  const words = text.split(/\s+/u);
  for (const [index, word] of words.entries()) {
    const bare = word.replace(/[^\p{L}\p{N}·.-]/gu, "");
    // Acronyms carry as much of the claim as long names do: "PP", "UE", "AVE".
    const allCaps = bare.length >= 2 && bare === bare.toUpperCase() && /\p{Lu}/u.test(bare);
    if (!allCaps && bare.length < 3) continue;
    const capitalised = /^\p{Lu}/u.test(bare);
    if (!allCaps && (!capitalised || index === 0)) continue;
    const normalized = normalizeText(bare);
    if (!normalized || NOT_A_NAME.has(normalized)) continue;
    anchors.add(normalized);
  }
  return [...anchors];
}

/** True when the source mentions at least one of the claim's anchors. */
export function mentionsAnchor(anchors: string[], candidate: EvidenceCandidate): boolean {
  if (anchors.length === 0) return true;
  const haystack = ` ${normalizeText(`${candidate.title} ${candidate.excerpt}`)} `;
  // Sources write a figure grouped ("19.000"), which normalisation turns into
  // "19 000", so digits are compared with the grouping removed.
  const digits = haystack.replace(/(\d)[\s](?=\d)/gu, "$1");
  return anchors.some((anchor) => {
    const normalized = normalizeText(anchor);
    if (!normalized) return false;
    // A whole-word match: a two letter acronym must not match inside a word.
    return /^\d+$/u.test(normalized)
      ? digits.includes(normalized)
      : haystack.includes(` ${normalized} `);
  });
}

/**
 * Penalty for a source that mentions none of the claim's figures or names.
 * Deliberately a demotion and not a filter: a relevant article often fails to
 * repeat the figure in the 200 characters a news feed gives us, and dropping
 * those outright cost real evidence (an EFE fact-check on rail investment was
 * discarded for not repeating "15").
 */
const UNANCHORED_PENALTY = 0.25;

