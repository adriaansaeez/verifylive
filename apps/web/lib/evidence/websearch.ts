import {
  CONNECTOR_TIMEOUT_MS,
  MAX_EXCERPT_CHARS,
  WEB_RESULTS,
  activeSearchProvider,
  type SearchProvider,
} from "@/lib/config";
import type { EvidenceCandidate } from "@/lib/types";
import { clip, extractSnippet, normalizeText, sanitizeUntrusted, tokenize } from "@/lib/text";
import { safeFetchText } from "./ssrf";
import { classifyTier } from "./rank";
import { searchSearxng } from "./searxng";

/**
 * Web search connector. Google's official Custom Search API is used when a key
 * is configured; Brave and GDELT are drop-in alternatives so the demo still
 * works with zero keys. We never scrape google.com: it blocks server traffic
 * and violates its terms.
 */

type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  publisher: string | null;
  publishedAt: string | null;
};

const USER_AGENT = "VerifyLive/0.1 (+https://github.com/adriaansaeez/verifylive; evidence retrieval)";
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 60;
const ENRICH_LIMIT = 3;
const ENRICH_TIMEOUT_MS = 5_000;

const cache = new Map<string, { at: number; hits: SearchHit[]; provider: SearchProvider }>();
/** SearXNG returns finished candidates, so it needs a cache of its own. */
const searxCache = new Map<string, { at: number; candidates: EvidenceCandidate[] }>();

function remember<T>(store: Map<string, T>, key: string, value: T): T {
  if (store.size >= CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, value);
  return value;
}

/**
 * Transactional hosts are never evidence. Asked about the inauguration of the
 * Madrid-Ourense line, Bing returned renfe.com, billetes.renfe.com,
 * thetrainline.com and omio.es: ticket shops that mention the entity and prove
 * nothing. Keyword matching cannot tell them apart, so they are excluded by
 * host.
 */
const COMMERCIAL_HOSTS = [
  "renfe.com",
  "trainline.com",
  "thetrainline.com",
  "omio.es",
  "omio.com",
  "trip.com",
  "rumbo.es",
  "atrapalo.com",
  "edreams.es",
  "kiwi.com",
  "booking.com",
  "expedia.es",
  "amazon.es",
  "amazon.com",
  "ebay.es",
  "aliexpress.com",
  "idealista.com",
  "milanuncios.com",
  "pinterest.com",
  "tripadvisor.es",
  "groupon.es",
];

/**
 * Aggregators and user-generated pages: no editorial accountability, or a
 * syndicated copy of an article whose original publisher is the better
 * citation. msn.com republished three of the hits in this interview.
 */
const LOW_VALUE_HOSTS = [
  "msn.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "reddit.com",
  "quora.com",
  "yahoo.com",
  "taringa.net",
  "scribd.com",
  "slideshare.net",
];

export function isExcludedHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return true;
  }
  return [...COMMERCIAL_HOSTS, ...LOW_VALUE_HOSTS].some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

/**
 * Upper bound only. Search engines do answer 5-7 word queries well (measured:
 * ten results each), but a whole spoken sentence pulled in dictionary and
 * product pages, so a query is capped rather than trimmed aggressively.
 * Producing short keyword queries is the canonicalizer's job.
 */
export function shortenQuery(query: string, maxWords = MAX_QUERY_WORDS): string {
  const words = query.trim().split(/\s+/u).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

const MAX_QUERY_WORDS = 12;

/**
 * Search engines happily return unrelated pages (a jobs claim matched "año",
 * a name matched a dictionary entry). A hit only counts as evidence when
 * meaningful query tokens appear in its title or snippet.
 */
export function hitMatchesQuery(title: string, snippet: string, queryTokens: string[]): boolean {
  const haystack = ` ${normalizeText(`${title} ${snippet}`)} `;
  const meaningful = queryTokens.filter((token) => token.length >= 3);
  if (meaningful.length === 0) return false;
  const matches = meaningful.filter((token) => haystack.includes(` ${token}`)).length;
  return matches >= (meaningful.length >= 4 ? 2 : 1);
}

function stripHtml(value: string): string {
  return sanitizeUntrusted(
    value
      .replace(/<[^>]*>/gu, " ")
      .replace(/&quot;/gu, '"')
      .replace(/&#39;|&apos;/gu, "'")
      .replace(/&amp;/gu, "&")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&nbsp;/gu, " "),
  );
}

function publisherFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function normalizeHit(hit: SearchHit): SearchHit | null {
  let url: string;
  try {
    const parsed = new URL(hit.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    url = parsed.toString();
  } catch {
    return null;
  }
  const title = stripHtml(hit.title).trim();
  if (!url || title.length < 3) return null;
  return {
    url,
    title: clip(title, 200),
    snippet: stripHtml(hit.snippet).trim(),
    publisher: hit.publisher ?? publisherFromUrl(url),
    publishedAt: hit.publishedAt ?? null,
  };
}

type GoogleResponse = {
  items?: { title?: string; link?: string; snippet?: string; displayLink?: string }[];
};

async function searchGoogle(query: string): Promise<SearchHit[]> {
  const key = process.env.GOOGLE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_ID?.trim();
  if (!key || !cx) return [];

  const params = new URLSearchParams({
    key,
    cx,
    q: query,
    num: String(WEB_RESULTS),
    hl: "es",
    gl: "es",
    safe: "off",
  });
  const result = await safeFetchText(
    `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
    { timeoutMs: CONNECTOR_TIMEOUT_MS, maxBytes: 400_000, headers: { "User-Agent": USER_AGENT } },
  );

  let payload: GoogleResponse;
  try {
    payload = JSON.parse(result.text) as GoogleResponse;
  } catch {
    return [];
  }

  return (payload.items ?? []).flatMap((item) => {
    if (!item.link) return [];
    const hit = normalizeHit({
      url: item.link,
      title: item.title ?? item.link,
      snippet: item.snippet ?? "",
      publisher: item.displayLink ?? null,
      publishedAt: null,
    });
    return hit ? [hit] : [];
  });
}

type BraveResponse = {
  web?: {
    results?: { title?: string; url?: string; description?: string; age?: string; profile?: { long_name?: string } }[];
  };
};

async function searchBrave(query: string): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];

  const params = new URLSearchParams({
    q: query,
    count: String(WEB_RESULTS),
    search_lang: "es",
    extra_snippets: "true",
  });
  const result = await safeFetchText(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      timeoutMs: CONNECTOR_TIMEOUT_MS,
      maxBytes: 600_000,
      headers: { "User-Agent": USER_AGENT, "X-Subscription-Token": key },
    },
  );

  let payload: BraveResponse;
  try {
    payload = JSON.parse(result.text) as BraveResponse;
  } catch {
    return [];
  }

  return (payload.web?.results ?? []).flatMap((item) => {
    if (!item.url) return [];
    const hit = normalizeHit({
      url: item.url,
      title: item.title ?? item.url,
      snippet: item.description ?? "",
      publisher: item.profile?.long_name ?? null,
      publishedAt: item.age ?? null,
    });
    return hit ? [hit] : [];
  });
}

type GdeltResponse = {
  articles?: { url?: string; title?: string; seendate?: string; domain?: string }[];
};

type BingResponse = string;

const BING_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/**
 * Keyless news search. The general web RSS endpoint answers "AVE Madrid
 * Ourense inauguración" with four ticket shops, and "seguridad sistema
 * ferroviario España" with social-security pages. The news endpoint answers
 * both with El País, RTVE, ABC and Maldita.es, carries a real 150-230
 * character lead as the description, and dates every hit. It is the best
 * evidence available without an API key.
 */
async function searchBingNews(query: string): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, format: "rss", setlang: "es", cc: "ES" });
  const result = await safeFetchText(`https://www.bing.com/news/search?${params.toString()}`, {
    timeoutMs: CONNECTOR_TIMEOUT_MS,
    maxBytes: 600_000,
    headers: { "User-Agent": BING_UA, Accept: "application/rss+xml, text/xml;q=0.9, */*;q=0.8" },
  });
  return parseBingRss(result.text)
    .map(unwrapBingRedirect)
    .filter((hit): hit is SearchHit => hit !== null);
}

/**
 * News items link through apiclick.aspx with the publisher URL in the `url`
 * parameter, so the real article is recovered without another request. A hit
 * that cannot be unwrapped is dropped: a redirector is not a citation.
 */
export function unwrapBingRedirect(hit: SearchHit): SearchHit | null {
  let parsed: URL;
  try {
    parsed = new URL(hit.url);
  } catch {
    return null;
  }
  if (!/(?:^|\.)bing\.com$/u.test(parsed.hostname)) return hit;
  const target = parsed.searchParams.get("url");
  if (!target) return null;
  return normalizeHit({ ...hit, url: target, publisher: null });
}

/** Keyless web search: Bing's RSS endpoint returns real results as XML. */
async function searchBing(query: string): Promise<SearchHit[]> {
  const params = new URLSearchParams({ format: "rss", q: query, setlang: "es" });
  const result = await safeFetchText(`https://www.bing.com/search?${params.toString()}`, {
    timeoutMs: CONNECTOR_TIMEOUT_MS,
    maxBytes: 600_000,
    headers: { "User-Agent": BING_UA, Accept: "application/rss+xml, text/xml;q=0.9, */*;q=0.8" },
  });
  return parseBingRss(result.text);
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

export function parseBingRss(xml: BingResponse): SearchHit[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gu) ?? [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/u)?.[1] ?? "";
    const link = item.match(/<link>([\s\S]*?)<\/link>/u)?.[1] ?? "";
    const description = item.match(/<description>([\s\S]*?)<\/description>/u)?.[1] ?? "";
    const date = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/u)?.[1] ?? "";
    if (!link) continue;
    const hit = normalizeHit({
      url: decodeXml(link).trim(),
      title: decodeXml(title),
      snippet: decodeXml(description),
      publisher: null,
      publishedAt: date ? decodeXml(date).trim() : null,
    });
    if (hit) hits.push(hit);
  }
  return hits;
}

/** GDELT is free and keyless, but throttles to one request every 5 seconds
 * globally. It returns headlines without snippets, so we fetch the body. */
async function searchGdelt(query: string): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    query: `${query} sourcelang:spanish`,
    mode: "artlist",
    maxrecords: String(WEB_RESULTS),
    format: "json",
    sort: "hybridrel",
  });
  const result = await safeFetchText(
    `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`,
    { timeoutMs: CONNECTOR_TIMEOUT_MS, maxBytes: 400_000, headers: { "User-Agent": USER_AGENT } },
  );

  let payload: GdeltResponse;
  try {
    payload = JSON.parse(result.text) as GdeltResponse;
  } catch {
    return [];
  }

  return (payload.articles ?? []).flatMap((item) => {
    if (!item.url) return [];
    const hit = normalizeHit({
      url: item.url,
      title: item.title ?? item.url,
      snippet: "",
      publisher: item.domain ?? null,
      publishedAt: item.seendate ?? null,
    });
    return hit ? [hit] : [];
  });
}

const lastCallAt = new Map<SearchProvider, number>();
const MIN_INTERVAL_MS: Record<SearchProvider, number> = {
  searxng: 0,
  google: 0,
  brave: 0,
  bingnews: 1_000,
  bing: 1_000,
  gdelt: 5_000,
};

async function pace(provider: SearchProvider): Promise<void> {
  const interval = MIN_INTERVAL_MS[provider];
  const previous = lastCallAt.get(provider) ?? 0;
  const wait = previous + interval - Date.now();
  lastCallAt.set(provider, Date.now() + Math.max(0, wait));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function runSearch(provider: SearchProvider, query: string): Promise<SearchHit[]> {
  await pace(provider);
  const capped = shortenQuery(query);
  // SearXNG returns ready-made evidence candidates, so it bypasses the hit
  // pipeline below and is handled by searchWeb directly.
  if (provider === "searxng") return [];
  if (provider === "google") return searchGoogle(capped);
  if (provider === "brave") return searchBrave(capped);
  if (provider === "bingnews") return searchBingNews(capped);
  if (provider === "bing") return searchBing(capped);
  return searchGdelt(capped);
}

/** Try the configured provider, then the rest of the chain if it returns
 * nothing: a keyless fallback keeps the demo alive when a quota dies. */
function providerChain(primary: SearchProvider): SearchProvider[] {
  const order: SearchProvider[] = ["searxng", "google", "brave", "bingnews", "bing", "gdelt"];
  const hasSearxng = Boolean(process.env.VERIFYLIVE_SEARXNG_URL?.trim());
  const hasGoogle = Boolean(process.env.GOOGLE_API_KEY?.trim() && process.env.GOOGLE_CSE_ID?.trim());
  const hasBrave = Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());
  const usable = order.filter((provider) => {
    if (provider === "searxng") return hasSearxng;
    if (provider === "google") return hasGoogle;
    if (provider === "brave") return hasBrave;
    return true;
  });
  return [primary, ...usable.filter((provider) => provider !== primary)];
}

/** Best-effort body text so a search snippet is not the whole evidence. */
async function enrichHit(hit: SearchHit, queryTokens: string[]): Promise<SearchHit> {
  if (hit.snippet.length >= 200) return hit;
  try {
    const page = await safeFetchText(hit.url, {
      timeoutMs: ENRICH_TIMEOUT_MS,
      maxBytes: 600_000,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!page.contentType.includes("html") && !page.contentType.includes("text")) return hit;
    const text = stripHtml(page.text);
    const snippet = extractSnippet(text, queryTokens, MAX_EXCERPT_CHARS);
    if (snippet.length > hit.snippet.length) return { ...hit, snippet };
    return hit;
  } catch {
    return hit;
  }
}

function dedupeByUrl(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const output: SearchHit[] = [];
  for (const hit of hits) {
    let key = hit.url;
    try {
      const parsed = new URL(hit.url);
      key = `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname}`.replace(/\/$/u, "");
    } catch {
      // keep raw url
    }
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(hit);
  }
  return output;
}

export async function searchWeb(query: string): Promise<EvidenceCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const provider = activeSearchProvider();
  if (!provider) return [];

  // One SearXNG request already carries publisher, snippet and date, so it
  // needs neither the page enrichment nor the keyword relevance filter the
  // RSS providers need to keep noise out. An empty answer falls through to
  // the rest of the chain rather than leaving the claim without evidence.
  if (providerChain(provider)[0] === "searxng") {
    const key = `searxng:${trimmed.toLowerCase()}`;
    const cached = searxCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      if (cached.candidates.length > 0) return cached.candidates;
    } else {
      const candidates = await searchSearxng(trimmed);
      remember(searxCache, key, { at: Date.now(), candidates });
      if (candidates.length > 0) return candidates;
    }
  }

  const cacheKey = `${provider}:${trimmed.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS ? cached : null;

  let hits: SearchHit[];
  let resultProvider: SearchProvider;
  if (fresh) {
    hits = fresh.hits;
    resultProvider = fresh.provider;
  } else {
    hits = [];
    resultProvider = provider;
    for (const candidate of providerChain(provider)) {
      hits = dedupeByUrl(await runSearch(candidate, trimmed)).slice(0, WEB_RESULTS);
      if (hits.length > 0) {
        resultProvider = candidate;
        break;
      }
    }
    remember(cache, cacheKey, { at: Date.now(), hits, provider: resultProvider });
  }

  const queryTokens = tokenize(trimmed);
  const enriched = await Promise.all(
    hits.slice(0, ENRICH_LIMIT).map((hit) => enrichHit(hit, queryTokens)),
  );
  const merged = [...enriched, ...hits.slice(ENRICH_LIMIT)];
  const relevant = merged.filter(
    (hit) =>
      !isExcludedHost(hit.url) &&
      hitMatchesQuery(hit.title, hit.snippet || hit.title, queryTokens),
  );

  return relevant.map((hit) => ({
    url: hit.url,
    title: hit.title,
    publisher: hit.publisher,
    publishedAt: hit.publishedAt,
    excerpt: clip(hit.snippet || hit.title, MAX_EXCERPT_CHARS),
    sourceTier: classifyTier(hit.url),
    stance: null,
    connector: `websearch:${resultProvider}`,
  }));
}
