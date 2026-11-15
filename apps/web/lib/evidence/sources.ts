import type { EvidenceCandidate } from "@/lib/types";

/**
 * Two Wikipedia pages are two citations but ONE outlet. Counting URLs lets a
 * single medium fake corroboration and unlock a non-provisional verdict, so the
 * policy counts distinct publishers instead.
 */
export function publisherKey(item: EvidenceCandidate): string {
  const raw = item.publisher?.trim() || hostOf(item.url) || item.url;
  return raw.toLowerCase().replace(/^www\./u, "").replace(/\s+/gu, " ");
}

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

export function distinctPublishers(evidence: EvidenceCandidate[]): number {
  return new Set(evidence.map((item) => publisherKey(item))).size;
}
