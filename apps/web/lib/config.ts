import type { RuntimeConfig } from "./types";
import { clefUnavailableReason } from "./clef/availability";

export type SearchProvider = "searxng" | "google" | "brave" | "bingnews" | "bing" | "gdelt";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return TRUE_VALUES.has(raw.toLowerCase());
}

/**
 * Server-side configuration. Never expose secrets: this object only reports
 * which capabilities are available so the UI can be honest about them.
 */
export function runtimeConfig(): RuntimeConfig {
  const nanKey = Boolean(process.env.NAN_KEY?.trim());
  const rerankConfigured = Boolean(
    process.env.NAN_RERANK_URL?.trim() && process.env.NAN_RERANK_MODEL?.trim(),
  );
  return {
    // Tener clave no basta: si el modelo ya no se sirve, decir «en vivo»
    // sería falso y además no saldría ninguna ficha.
    clefMode: nanKey && !clefUnavailableReason() ? "live" : "simulated",
    clefNote: nanKey ? clefUnavailableReason() : null,
    evidenceMode: nanKey ? "live" : "simulated",
    chatExtractor: Boolean(process.env.NAN_CHAT_MODEL?.trim() && nanKey),
    rerank: rerankConfigured && nanKey ? "nan" : "local",
    wikipedia: flag("VERITAS_ENABLE_WIKIPEDIA", true),
    jina: Boolean(process.env.JINA_API_KEY?.trim()),
    cloudEvidence: Boolean(process.env.JINA_API_KEY?.trim()),
    search: activeSearchProvider(),
  };
}

const PROVIDERS = new Set<string>(["searxng", "google", "brave", "bingnews", "bing", "gdelt"]);

/**
 * Web search provider chain.
 *
 * A self-hosted SearXNG wins when one is configured: benchmarked on eight
 * Spanish claims with the NaN reranker as judge, it found a relevant source
 * for 8/8 (mean relevance 0.93) against 6/8 and 0.66 for the keyless Bing
 * news RSS, and it is the only option that returns publisher URLs, snippets
 * and dates together without an API key. Google's Custom Search and Brave
 * come next when a key exists, and the RSS providers keep the app working
 * with zero setup. `VERITAS_SEARCH_PROVIDER=none` disables web search.
 */
export function activeSearchProvider(): SearchProvider | null {
  const forced = process.env.VERITAS_SEARCH_PROVIDER?.trim().toLowerCase();
  const hasSearxng = Boolean(process.env.VERITAS_SEARXNG_URL?.trim());
  const hasGoogle = Boolean(
    process.env.GOOGLE_API_KEY?.trim() && process.env.GOOGLE_CSE_ID?.trim(),
  );
  const hasBrave = Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());

  if (forced === "none") return null;
  if (PROVIDERS.has(forced ?? "")) return forced as SearchProvider;
  if (hasSearxng) return "searxng";
  if (hasGoogle) return "google";
  if (hasBrave) return "brave";
  // Bing's news RSS needs no key and indexes press only, which is what a
  // fact-check needs. The general web RSS stays as the next fallback, and
  // GDELT throttles to one request per 5 s globally, so it is opt-in.
  return "bingnews";
}

export function searchProviderLabel(provider: SearchProvider): string {
  if (provider === "searxng") return "SearXNG (autoalojado)";
  if (provider === "google") return "Google (Custom Search)";
  if (provider === "brave") return "Brave Search";
  if (provider === "bingnews") return "Bing Noticias (RSS)";
  if (provider === "bing") return "Bing web (RSS)";
  return "GDELT (prensa)";
}

export const CLEF_URL = "https://api.nan.builders/v1/systemone";
export const CHAT_URL =
  process.env.NAN_CHAT_URL?.trim() || "https://api.nan.builders/v1/chat/completions";
export const CLEF_TIMEOUT_MS = 50_000;
export const CONNECTOR_TIMEOUT_MS = 8_000;
/** Claim normalisation runs between detection and search, so it is on the
 * critical path of a live verdict. */
export const CANONICALIZE_TIMEOUT_MS = 20_000;
export const MAX_CANDIDATES = 8;
export const MAX_EVIDENCE = 3;
export const MAX_EXCERPT_CHARS = 1_500;

/** SearXNG returns 40+ merged results; the reranker does the rest. */
export const SEARXNG_RESULTS = Math.min(
  20,
  Math.max(1, Number.parseInt(process.env.VERITAS_SEARXNG_RESULTS ?? "8", 10) || 8),
);

/** How many web results to ask the search provider for. */
export const WEB_RESULTS = Math.min(
  5,
  Math.max(1, Number.parseInt(process.env.VERITAS_WEB_RESULTS ?? "3", 10) || 3),
);
export const MIN_CHECKABLE = 0.65;
export const MIN_CONFIDENCE = 0.65;
export const PROVISIONAL_NEEDS_MORE = 0.65;
