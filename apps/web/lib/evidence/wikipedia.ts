import { CONNECTOR_TIMEOUT_MS, MAX_EXCERPT_CHARS } from "@/lib/config";
import type { EvidenceCandidate } from "@/lib/types";
import { clip, extractSnippet, tokenize } from "@/lib/text";
import { safeFetchText } from "./ssrf";

type WikiPage = {
  pageid?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  canonicalurl?: string;
};

type WikiResponse = {
  query?: { pages?: WikiPage[] };
};

const USER_AGENT = "VeritasLive/0.1 (+https://github.com/adriaansaeez/veritas-live; evidence retrieval)";

export async function searchWikipedia(query: string, language = "es"): Promise<EvidenceCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: trimmed,
    gsrlimit: "3",
    // `prop=extracts` alone never returns a url, so every citation used to
    // fall back to the opaque "?curid=507698" form. `info` + `inprop=url` is
    // what produces the readable article link.
    prop: "extracts|info",
    inprop: "url",
    explaintext: "1",
    exintro: "1",
    exlimit: "max",
    redirects: "1",
  });
  const endpoint = `https://${language}.wikipedia.org/w/api.php?${params.toString()}`;

  const result = await safeFetchText(endpoint, {
    timeoutMs: CONNECTOR_TIMEOUT_MS,
    maxBytes: 800_000,
    headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
  });

  let payload: WikiResponse;
  try {
    payload = JSON.parse(result.text) as WikiResponse;
  } catch {
    return [];
  }

  const pages = payload.query?.pages ?? [];
  const queryTokens = tokenize(trimmed);
  const candidates: EvidenceCandidate[] = [];

  for (const page of pages) {
    if (!page.title || !page.extract || page.extract.length < 40) continue;
    const pageId = typeof page.pageid === "number" ? page.pageid : null;
    const url =
      page.fullurl ??
      page.canonicalurl ??
      (pageId ? `https://${language}.wikipedia.org/?curid=${pageId}` : null);
    if (!url) continue;
    const excerpt = clip(page.extract, MAX_EXCERPT_CHARS);
    const snippet = extractSnippet(page.extract, queryTokens, 900) || excerpt;
    candidates.push({
      url,
      title: page.title,
      publisher: language === "es" ? "Wikipedia en español" : "Wikipedia",
      publishedAt: null,
      excerpt: snippet,
      sourceTier: "reliable_secondary",
      stance: null,
      connector: "wikipedia",
    });
  }

  return candidates;
}
