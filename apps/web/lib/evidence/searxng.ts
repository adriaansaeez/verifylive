import { CONNECTOR_TIMEOUT_MS, MAX_EXCERPT_CHARS, SEARXNG_RESULTS } from "@/lib/config";
import type { EvidenceCandidate } from "@/lib/types";
import { clip, sanitizeUntrusted } from "@/lib/text";
import { classifyTier } from "./rank";
import { isExcludedHost } from "./websearch";
import { safeFetchText } from "./ssrf";

/**
 * SearXNG connector.
 *
 * SearXNG is a self-hosted metasearch engine: one request fans out to Brave,
 * Startpage, DuckDuckGo, Mojeek and friends and comes back with publisher
 * URLs, real snippets and dates. Benchmarked against every keyless
 * alternative on eight Spanish claims, scoring each result with the NaN
 * reranker, it was the only provider that found a relevant source for all
 * eight (mean relevance 0.93 against 0.66 for the Bing news RSS fallback),
 * and the only one that surfaced primary sources such as lamoncloa.gob.es.
 *
 * It is optional on purpose: without `VERIFYLIVE_SEARXNG_URL` the app falls back
 * to the keyless RSS providers and still runs with zero setup.
 */

type SearxResult = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  publishedDate?: unknown;
  engine?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? sanitizeUntrusted(value) : "";
}

export function parseSearxResults(payload: unknown, limit: number): EvidenceCandidate[] {
  const rows = payload && typeof payload === "object" ? (payload as { results?: unknown }).results : null;
  if (!Array.isArray(rows)) return [];

  const output: EvidenceCandidate[] = [];
  const seen = new Set<string>();

  for (const row of rows as SearxResult[]) {
    if (output.length >= limit) break;
    const rawUrl = typeof row.url === "string" ? row.url : "";
    let url: string;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      url = parsed.toString();
    } catch {
      continue;
    }
    if (isExcludedHost(url)) continue;
    const key = url.replace(/\/$/u, "");
    if (seen.has(key)) continue;
    seen.add(key);

    const title = clip(text(row.title), 200);
    if (title.length < 3) continue;
    const excerpt = clip(text(row.content) || title, MAX_EXCERPT_CHARS);
    const publishedAt = text(row.publishedDate) || null;

    output.push({
      url,
      title,
      publisher: hostOf(url),
      publishedAt,
      excerpt,
      sourceTier: classifyTier(url),
      stance: null,
      // The engine that found it is kept in the connector name so the
      // traceability panel shows which backend actually answered.
      connector: `websearch:searxng${typeof row.engine === "string" && row.engine ? `/${row.engine}` : ""}`,
    });
  }

  return output;
}

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

export function searxngBaseUrl(): string | null {
  const configured = process.env.VERIFYLIVE_SEARXNG_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

export async function searchSearxng(query: string): Promise<EvidenceCandidate[]> {
  const base = searxngBaseUrl();
  const trimmed = query.trim();
  if (!base || !trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: "json",
    language: process.env.VERIFYLIVE_SEARXNG_LANGUAGE?.trim() || "es",
    safesearch: "0",
  });

  const result = await safeFetchText(`${base}/search?${params.toString()}`, {
    timeoutMs: CONNECTOR_TIMEOUT_MS,
    maxBytes: 1_500_000,
    headers: { Accept: "application/json" },
    // The operator configured this origin; it is usually on localhost, which
    // the SSRF guard blocks by default and must keep blocking for every URL
    // that arrives from the open web.
    trustedOrigin: true,
  });

  let payload: unknown;
  try {
    payload = JSON.parse(result.text);
  } catch {
    return [];
  }
  return parseSearxResults(payload, SEARXNG_RESULTS);
}
