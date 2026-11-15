import { MAX_EVIDENCE, MAX_EXCERPT_CHARS } from "@/lib/config";
import type { EvidenceCandidate, SourceTier, Stance } from "@/lib/types";
import { clip, lexicalScore, tokenCoverage, tokenize } from "@/lib/text";
import { claimAnchors, mentionsAnchor, numbersOf } from "@/lib/claims/anchors";

const TIER_WEIGHT: Record<SourceTier, number> = {
  primary: 1,
  reliable_secondary: 0.7,
  other: 0.35,
};

const PRIMARY_DOMAINS = [
  "gov",
  "edu",
  "who.int",
  "un.org",
  "europa.eu",
  "ipcc.ch",
  "nasa.gov",
  "noaa.gov",
  "ine.es",
  "aemet.es",
  "boe.es",
  "gob.es",
  "adif.es",
  "congreso.es",
  "senado.es",
  "seg-social.es",
  "eurostat.ec.europa.eu",
  "worldbank.org",
  "imf.org",
  "oecd.org",
  "nature.com",
  "science.org",
];

const SECONDARY_DOMAINS = [
  "elpais.com",
  "elmundo.es",
  "eldiario.es",
  "bbc.com",
  "bbc.co.uk",
  "reuters.com",
  "apnews.com",
  "newtral.es",
  "maldita.es",
  "snopes.com",
  "politifact.com",
  "efeverde.com",
  "rtve.es",
  "lavanguardia.com",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "ourworldindata.org",
  "statista.com",
  "abc.es",
  "elconfidencial.com",
  "europapress.es",
  "20minutos.es",
  "publico.es",
  "infolibre.es",
  "elperiodico.com",
  "lasexta.com",
  "cadenaser.com",
  "cope.es",
  "telecinco.es",
  "antena3.com",
  "eleconomista.es",
  "cincodias.elpais.com",
  "expansion.com",
  "lavozdegalicia.es",
  "heraldo.es",
  "elcorreo.com",
  "france24.com",
  "euronews.com",
  "verificat.cat",
  "efe.com",
];

/** Host-based tiering is a heuristic, not a truth oracle. The UI never hides it. */
export function classifyTier(rawUrl: string): SourceTier {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return "other";
  }
  if (/(^|\.)(gov|mil|gob)(\.[a-z]{2})?$/u.test(host) || host.endsWith(".edu")) return "primary";
  if (PRIMARY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "primary";
  if (SECONDARY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "reliable_secondary";
  }
  return "other";
}

export function canonicalUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/iu.test(key)) url.searchParams.delete(key);
    }
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}${url.search}`;
  } catch {
    return rawUrl;
  }
}

const NEGATIONS = ["no fue", "nunca", "falso", "incorrecto", "no es cierto", "desmiente", "refuta", "no ocurrió", "no ocurrio"];
const CONFIRMATIONS = ["confirmó", "confirmo", "según", "segun", "de acuerdo con", "datos de", "informe de"];

/**
 * Local stance is deliberately conservative: it only claims "supports" or
 * "contradicts" when a number or an explicit marker earns it. Everything else
 * stays "context" and Clef makes the final call.
 */
export function detectStance(claim: string, excerpt: string): Stance {
  const claimNumbers = numbersOf(claim);
  const excerptNumbers = new Set(numbersOf(excerpt));
  const normalized = excerpt.toLowerCase();

  if (claimNumbers.length > 0 && excerptNumbers.size > 0) {
    const shared = claimNumbers.filter((value) => excerptNumbers.has(value));
    if (shared.length === claimNumbers.length) return "supports";
    if (shared.length === 0) {
      const explicitNo = NEGATIONS.some((marker) => normalized.includes(marker));
      return explicitNo ? "contradicts" : "context";
    }
  }

  if (NEGATIONS.some((marker) => normalized.includes(marker)) && tokenCoverage(tokenize(claim), tokenize(excerpt)) >= 0.4) {
    return "contradicts";
  }
  if (CONFIRMATIONS.some((marker) => normalized.includes(marker))) return "supports";
  return "context";
}

/**
 * Penalty for a source that mentions none of the claim's figures or names.
 * Deliberately a demotion and not a filter: a relevant article often fails to
 * repeat the figure in the 200 characters a news feed gives us, and dropping
 * those outright cost real evidence (an EFE fact-check on rail investment was
 * discarded for not repeating "15").
 */
const UNANCHORED_PENALTY = 0.25;

export function scoreCandidate(
  claimTokens: string[],
  candidate: EvidenceCandidate,
  anchors: string[] = [],
): number {
  const document = `${candidate.title} ${candidate.excerpt}`;
  const documentTokens = tokenize(document);
  const lexical = lexicalScore(claimTokens, document);
  const coverage = tokenCoverage(claimTokens, documentTokens);
  const tier = TIER_WEIGHT[candidate.sourceTier];
  const connectorBoost = candidate.connector === "corpus" ? 1 : 0;
  const anchored = candidate.connector === "corpus" || mentionsAnchor(anchors, candidate);
  return (
    lexical * 0.4 +
    coverage * 0.25 +
    tier * 0.25 +
    connectorBoost * 0.1 -
    (anchored ? 0 : UNANCHORED_PENALTY)
  );
}

export function rankCandidates(
  claim: string,
  candidates: EvidenceCandidate[],
  limit = MAX_EVIDENCE,
): EvidenceCandidate[] {
  const claimTokens = tokenize(claim);
  const anchors = claimAnchors(claim);
  const scored: { candidate: EvidenceCandidate; score: number }[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate.url || !candidate.excerpt) continue;
    const canonical = canonicalUrl(candidate.url);
    const titleKey = candidate.title.toLowerCase().trim();
    if (seenUrls.has(canonical) || seenTitles.has(titleKey)) continue;
    seenUrls.add(canonical);
    seenTitles.add(titleKey);
    scored.push({
      candidate: {
        ...candidate,
        url: canonical,
        excerpt: clip(candidate.excerpt, MAX_EXCERPT_CHARS),
        stance: candidate.stance ?? detectStance(claim, candidate.excerpt),
      },
      score: scoreCandidate(claimTokens, candidate, anchors),
    });
  }

  scored.sort((left, right) => right.score - left.score);

  const selected: EvidenceCandidate[] = [];
  const perHost = new Map<string, number>();
  for (const entry of scored) {
    const host = hostOf(entry.candidate.url);
    const used = perHost.get(host) ?? 0;
    if (used >= 2) continue;
    perHost.set(host, used + 1);
    selected.push(entry.candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

type RerankResponse = {
  results?: { index?: number; relevance_score?: number; score?: number }[];
  data?: { index?: number; relevance_score?: number; score?: number }[];
};

/**
 * Minimum semantic relevance a source must reach to be shown as evidence.
 *
 * Measured against the NaN reranker on the cases this pipeline actually got
 * wrong: a source that states the claim scores 0.89 to 0.99, while "Historia
 * del ferrocarril en España" scored 0.198 for "muchos territorios quieren
 * extender la alta velocidad" and so cleared the old 0.05 floor and was shown
 * as evidence. Topically related material scores anywhere from 0.01 to 0.2, so
 * no floor separates useful context from topical noise; the cut therefore
 * keeps only sources that address the claim itself. Everything else leaves the
 * verdict unverifiable, which is the honest answer.
 */
export const RERANK_MIN_SCORE = 0.3;

export type RerankOutcome = {
  candidates: EvidenceCandidate[];
  dropped: number;
};

/**
 * Optional NaN rerank. If the endpoint is slow, misconfigured or returns
 * anything unexpected we keep the local order rather than fail the claim.
 */
export async function maybeRerank(
  claim: string,
  candidates: EvidenceCandidate[],
): Promise<RerankOutcome> {
  const url = process.env.NAN_RERANK_URL?.trim();
  const model = process.env.NAN_RERANK_MODEL?.trim();
  const key = process.env.NAN_KEY?.trim();
  if (!url || !model || !key || candidates.length < 2) return { candidates, dropped: 0 };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        query: claim,
        documents: candidates.map((candidate) => `${candidate.title}\n${candidate.excerpt}`),
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return { candidates, dropped: 0 };
    const payload = (await response.json()) as RerankResponse;
    const rows = payload.results ?? payload.data;
    if (!Array.isArray(rows) || rows.length === 0) return { candidates, dropped: 0 };

    const scoreByIndex = new Map<number, number>();
    for (const row of rows) {
      if (typeof row.index !== "number") continue;
      const score = row.relevance_score ?? row.score;
      if (typeof score === "number" && Number.isFinite(score)) scoreByIndex.set(row.index, score);
    }
    if (scoreByIndex.size === 0) return { candidates, dropped: 0 };

    // Score by position, not by indexOf: two hits can share a reference and
    // indexOf would then score one of them with the other's relevance.
    const scored = candidates.map((candidate, index) => ({
      candidate,
      score: scoreByIndex.get(index) ?? 0,
    }));
    const kept = scored
      .filter((entry) => entry.score >= RERANK_MIN_SCORE)
      .sort((left, right) => right.score - left.score);

    return { candidates: kept.map((entry) => entry.candidate), dropped: scored.length - kept.length };
  } catch {
    return { candidates, dropped: 0 };
  }
}

/**
 * Applies local quality/diversity filtering before the optional remote rerank.
 * The remote order is final: reranking before rankCandidates would be silently
 * discarded by the local score sort.
 */
export async function rankAndRerankCandidates(
  claim: string,
  candidates: EvidenceCandidate[],
  limit = MAX_EVIDENCE,
): Promise<RerankOutcome> {
  const locallyRanked = rankCandidates(claim, candidates, Math.max(limit, MAX_EVIDENCE * 2));
  const reranked = await maybeRerank(claim, locallyRanked);
  return { candidates: reranked.candidates.slice(0, limit), dropped: reranked.dropped };
}
