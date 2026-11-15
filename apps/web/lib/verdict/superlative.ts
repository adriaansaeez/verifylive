import { normalizeText } from "@/lib/text";

/**
 * "un récord histórico", "el mejor plato del mundo", "el primero en..." are
 * claims in their own right: a source can confirm the number and still say
 * nothing about the superlative. When that happens the honest verdict is
 * `misleading`, not `supported`.
 */
const MARKERS: { pattern: RegExp; canonical: string }[] = [
  { pattern: /r[ée]cords?/iu, canonical: "record" },
  { pattern: /\bhist[óo]ric[oa]s?\b/iu, canonical: "historico" },
  { pattern: /\bsin precedentes\b/iu, canonical: "sin precedentes" },
  { pattern: /\bel mejor\b/iu, canonical: "mejor" },
  { pattern: /\bla mejor\b/iu, canonical: "mejor" },
  { pattern: /\blos mejores\b/iu, canonical: "mejor" },
  { pattern: /\bel primero\b/iu, canonical: "primero" },
  { pattern: /\bla primera\b/iu, canonical: "primero" },
  { pattern: /\bel mayor\b/iu, canonical: "mayor" },
  { pattern: /\bla mayor\b/iu, canonical: "mayor" },
  { pattern: /\bel [úu]nico\b/iu, canonical: "unico" },
  { pattern: /\bla [úu]nica\b/iu, canonical: "unico" },
  { pattern: /\bnunca antes\b/iu, canonical: "nunca antes" },
  { pattern: /\bel m[áa]s\b/iu, canonical: "mas" },
  { pattern: /\bla m[áa]s\b/iu, canonical: "mas" },
];

export type SuperlativeCheck = "none" | "supported" | "unsupported";

export function superlativeMarkers(text: string): string[] {
  const normalized = normalizeText(text);
  const found = new Set<string>();
  for (const marker of MARKERS) {
    if (marker.pattern.test(text)) found.add(marker.canonical);
  }
  // Belt and braces for text that only survives normalization.
  if (normalized.includes("record")) found.add("record");
  return [...found];
}

/** null when the claim carries no superlative at all. */
export function checkSuperlative(claimText: string, evidenceExcerpts: string[]): SuperlativeCheck {
  const markers = superlativeMarkers(claimText);
  if (markers.length === 0) return "none";

  const corpus = normalizeText(evidenceExcerpts.join(" \n "));
  const covered = markers.some((marker) => corpus.includes(marker));
  return covered ? "supported" : "unsupported";
}
