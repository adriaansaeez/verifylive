import { MAX_EVIDENCE, activeSearchProvider, runtimeConfig } from "@/lib/config";
import { corpusEntries, type CorpusEntry } from "@/lib/fixtures";
import type { ClefMode, ConnectorReport, EvidenceCandidate } from "@/lib/types";
import { jaccard, normalizeText, tokenCoverage, tokenize } from "@/lib/text";
import { keywordQuery } from "@/lib/claims/heuristic";
import { searchJina } from "./jina";
import { classifyPublishers, hostOf } from "./publisher";
import { getPublisherTier, setPublisherTier } from "@/lib/db/repo";
import { rankAndRerankCandidates } from "./rank";
import { searchWikipedia } from "./wikipedia";
import { searchWeb } from "./websearch";

export type ConnectorRun = ConnectorReport;

export type EvidenceBundle = {
  candidates: EvidenceCandidate[];
  corpusEntry: CorpusEntry | null;
  connectors: ConnectorRun[];
  droppedByRerank: number;
};

/**
 * Corpus matching is what makes the demo honest without pretending it is live
 * search: when a claim matches a curated entry we surface that entry's
 * evidence and expected verdict, labelled as curated.
 */
export function matchCorpus(claimText: string): CorpusEntry | null {
  const claimTokens = tokenize(claimText);
  const normalizedClaim = normalizeText(claimText);
  let best: { entry: CorpusEntry; score: number } | null = null;

  for (const entry of corpusEntries()) {
    const variants = [entry.claim, ...entry.aliases];
    let score = 0;
    for (const variant of variants) {
      const variantTokens = tokenize(variant);
      const similarity = jaccard(claimTokens, variantTokens);
      const coverage = tokenCoverage(tokenize(entry.keywords.join(" ")), claimTokens);
      const contained = normalizeText(variant).length > 20 && normalizedClaim.includes(normalizeText(variant)) ? 0.25 : 0;
      score = Math.max(score, similarity * 0.5 + coverage * 0.5 + contained);
    }
    if (!best || score > best.score) best = { entry, score };
  }

  if (!best) return null;
  const keywordHit = best.entry.keywords.filter((keyword) => normalizedClaim.includes(normalizeText(keyword))).length;
  if (best.score < 0.55 && keywordHit < 2) return null;
  return best.entry;
}

function corpusCandidates(entry: CorpusEntry): EvidenceCandidate[] {
  return entry.evidence.map((item) => ({
    url: item.url,
    title: item.title,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
    excerpt: item.excerpt,
    sourceTier: item.sourceTier,
    stance: item.stance,
    connector: "corpus",
  }));
}

/**
 * Only the sources we are about to cite get classified, so an unknown outlet
 * costs at most three model calls per claim and none at all once it is known.
 * The offline rules already placed anything in the built-in lists.
 */
async function resolveTiers(candidates: EvidenceCandidate[]): Promise<EvidenceCandidate[]> {
  const unknown = candidates
    .filter((candidate) => candidate.sourceTier === "other" && candidate.connector !== "corpus")
    .map((candidate) => hostOf(candidate.url))
    .filter((host): host is string => Boolean(host));
  if (unknown.length === 0) return candidates;

  const tiers = await classifyPublishers(unknown, {
    get: getPublisherTier,
    set: setPublisherTier,
  });

  return candidates.map((candidate) => {
    if (candidate.sourceTier !== "other") return candidate;
    const host = hostOf(candidate.url);
    const tier = host ? tiers.get(host) : null;
    return tier && tier !== candidate.sourceTier ? { ...candidate, sourceTier: tier } : candidate;
  });
}

type ConnectorOutcome = { name: string; candidates: EvidenceCandidate[]; error?: string; ms: number };

async function runConnector(name: string, work: () => Promise<EvidenceCandidate[]>): Promise<ConnectorOutcome> {
  const started = Date.now();
  try {
    const candidates = await work();
    return { name, candidates, ms: Date.now() - started };
  } catch (error) {
    return {
      name,
      candidates: [],
      error: error instanceof Error ? error.message : "error desconocido",
      ms: Date.now() - started,
    };
  }
}

export async function gatherEvidence(
  claim: { text: string; searchQueries: string[] },
  options: { mode: ClefMode },
): Promise<EvidenceBundle> {
  const corpusEntry = matchCorpus(claim.text);
  const primaryQuery = claim.searchQueries[0] ?? claim.text;
  const secondaryQuery = claim.searchQueries[1] ?? claim.text;

  const connectors: ConnectorRun[] = [];
  const candidates: EvidenceCandidate[] = [];

  if (corpusEntry) {
    const curated = corpusCandidates(corpusEntry);
    candidates.push(...curated);
    connectors.push({ name: "corpus", ok: true, count: curated.length, ms: 0 });
  }

  if (options.mode === "live") {
    const jobs: Promise<ConnectorOutcome>[] = [];
    if (runtimeConfig().wikipedia) {
      jobs.push(runConnector("wikipedia", () => searchWikipedia(primaryQuery)));
      if (secondaryQuery !== primaryQuery) {
        jobs.push(
          runConnector("wikipedia-2", () => searchWikipedia(secondaryQuery)),
        );
      }
    }
    const searchProvider = activeSearchProvider();
    if (searchProvider) {
      // Search engines want keywords, not a spoken sentence: "creó quinientos
      // mil empleos, un récord histórico" searches for "creo empleos record
      // historico" and returns noise.
      const webQuery = primaryQuery || keywordQuery(claim.text);
      jobs.push(runConnector(`websearch:${searchProvider}`, () => searchWeb(webQuery)));
      // One query finds one framing of the fact. The canonicalizer writes a
      // second, differently worded query precisely so a claim is not judged on
      // whatever a single phrasing happened to return.
      if (secondaryQuery && secondaryQuery !== webQuery) {
        jobs.push(
          runConnector(`websearch:${searchProvider}:2`, () => searchWeb(secondaryQuery)),
        );
      }
    }
    if (process.env.JINA_API_KEY?.trim()) {
      jobs.push(runConnector("jina", () => searchJina(primaryQuery)));
    }

    const settled = await Promise.all(jobs);
    for (const outcome of settled) {
      candidates.push(...outcome.candidates);
      // The provider that actually answered can differ from the one asked for,
      // because the chain falls through when one returns nothing.
      const answered = outcome.candidates.find((candidate) =>
        candidate.connector.startsWith("websearch:"),
      )?.connector;
      const reportedName = outcome.name.startsWith("websearch:") && answered
        ? `${answered}${outcome.name.endsWith(":2") ? ":2" : ""}`
        : outcome.name;
      connectors.push({
        name: reportedName,
        ok: !outcome.error,
        count: outcome.candidates.length,
        ms: outcome.ms,
        ...(outcome.error ? { error: outcome.error } : {}),
      });
    }
  }

  const ranked = await rankAndRerankCandidates(claim.text, candidates, MAX_EVIDENCE);
  const cited = await resolveTiers(ranked.candidates);

  return {
    candidates: cited,
    corpusEntry,
    connectors,
    droppedByRerank: ranked.dropped,
  };
}
