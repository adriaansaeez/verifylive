import { runtimeConfig } from "@/lib/config";
import type { ExtractedClaim, TranscriptSegment } from "@/lib/types";
import { dedupeKey, jaccard, sanitizeUntrusted, tokenize } from "@/lib/text";
import { extractWithChat } from "./chat";
import { extractHeuristicClaims } from "./heuristic";

export type ExtractionResult = {
  claims: ExtractedClaim[];
  extractor: "chat" | "heuristic";
  deduped: number;
};

function similar(left: string, right: string): boolean {
  if (left === right) return true;
  return jaccard(tokenize(left), tokenize(right)) >= 0.85;
}

/**
 * Extracts claims from one final segment. Overlap between consecutive
 * segments is common in streaming ASR, so we dedupe within the batch and let
 * the repository's unique index handle cross-segment duplicates.
 */
export async function extractClaims(segment: TranscriptSegment): Promise<ExtractionResult> {
  const text = sanitizeUntrusted(segment.text);
  if (!text) return { claims: [], extractor: "heuristic", deduped: 0 };

  const config = runtimeConfig();
  const extractor = config.chatExtractor ? "chat" : "heuristic";
  const raw =
    extractor === "chat"
      ? await extractWithChat({ text, startMs: segment.startMs, endMs: segment.endMs })
      : extractHeuristicClaims({ text, startMs: segment.startMs, endMs: segment.endMs });

  const claims: ExtractedClaim[] = [];
  const seenKeys = new Set<string>();
  let deduped = 0;

  for (const claim of raw) {
    const key = dedupeKey(claim.text);
    if (seenKeys.has(key)) {
      deduped += 1;
      continue;
    }
    if (claims.some((existing) => similar(existing.normalizedText, claim.normalizedText))) {
      deduped += 1;
      continue;
    }
    seenKeys.add(key);
    claims.push(claim);
  }

  return {
    claims: claims.sort((left, right) => left.startMs - right.startMs),
    extractor,
    deduped,
  };
}
