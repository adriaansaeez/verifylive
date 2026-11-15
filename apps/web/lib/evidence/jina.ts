import { CONNECTOR_TIMEOUT_MS, MAX_EXCERPT_CHARS } from "@/lib/config";
import type { EvidenceCandidate } from "@/lib/types";
import { clip, extractSnippet, tokenize } from "@/lib/text";
import { classifyTier } from "./rank";
import { safeFetchText } from "./ssrf";

type JinaItem = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  content?: unknown;
};

type JinaResponse = { data?: JinaItem[] };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Jina search returns clean, readable pages for URLs other connectors cannot
 * reach. It is optional: without JINA_API_KEY the app runs on Wikipedia +
 * curated corpus and says so in the UI.
 */
export async function searchJina(query: string): Promise<EvidenceCandidate[]> {
  const key = process.env.JINA_API_KEY?.trim();
  const trimmed = query.trim();
  if (!key || !trimmed) return [];

  const result = await safeFetchText(`https://s.jina.ai/${encodeURIComponent(trimmed)}`, {
    timeoutMs: CONNECTOR_TIMEOUT_MS,
    maxBytes: 1_200_000,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "X-Retain-Images": "none",
    },
  });

  const queryTokens = tokenize(trimmed);
  const candidates: EvidenceCandidate[] = [];

  const parsed = parseJinaJson(result.text);
  if (parsed.length > 0) {
    for (const item of parsed.slice(0, 3)) {
      const url = asString(item.url);
      const title = asString(item.title);
      const body = asString(item.content) || asString(item.description);
      if (!url || !title || body.length < 40) continue;
      candidates.push({
        url,
        title,
        publisher: hostnameOf(url),
        publishedAt: null,
        excerpt: clip(extractSnippet(body, queryTokens, 900) || body, MAX_EXCERPT_CHARS),
        sourceTier: classifyTier(url),
        stance: null,
        connector: "jina",
      });
    }
    if (candidates.length > 0) return candidates;
  }

  // Fallback: Jina's plain-text reader format.
  const blocks = result.text.split(/\n(?=Title:\s)/u).slice(0, 3);
  for (const block of blocks) {
    const title = block.match(/^Title:\s*(.+)$/mu)?.[1]?.trim() ?? "";
    const url = block.match(/^URL Source:\s*(\S+)$/mu)?.[1]?.trim() ?? "";
    const content = block.replace(/^(?:Title|URL Source|Description|Published Time):.*$/gmu, "").trim();
    if (!title || !url || content.length < 40) continue;
    candidates.push({
      url,
      title,
      publisher: hostnameOf(url),
      publishedAt: null,
      excerpt: clip(extractSnippet(content, queryTokens, 900) || content, MAX_EXCERPT_CHARS),
      sourceTier: classifyTier(url),
      stance: null,
      connector: "jina",
    });
  }

  return candidates;
}

function parseJinaJson(text: string): JinaItem[] {
  try {
    const payload = JSON.parse(text) as JinaResponse;
    return Array.isArray(payload.data) ? payload.data : [];
  } catch {
    return [];
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}
