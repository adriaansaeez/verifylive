import { randomUUID } from "node:crypto";
import { runtimeConfig } from "@/lib/config";
import {
  buildQuestions,
  callClefRaw,
  ClefError,
  parseClefResponse,
  type ClefRawResponse,
} from "@/lib/clef/client";
import { clefQueue } from "@/lib/clef/queue";
import {
  getClaim,
  getSession,
  insertClaim,
  insertEvidence,
  insertRevision,
  insertSegments,
  listEvidence,
  nextRevisionNumber,
  nextSegmentSeq,
  setSessionStatus,
  updateClaimStatus,
} from "@/lib/db/repo";
import { buildQueries, classifyCheckability } from "@/lib/claims/heuristic";
import { ClaimWindow, type ClaimCandidate } from "@/lib/claims/claim-window";
import { gateCandidates, runGate } from "@/lib/claims/gate";
import { canonicalizeClaim, type CanonicalClaim } from "@/lib/claims/canonicalize";
import { gatherEvidence } from "@/lib/evidence";
import type {
  Claim,
  DecisionRevision,
  Evidence,
  EvidenceCandidate,
  GateDiagnostics,
  RevisionDiagnostics,
  Session,
  SessionEvent,
  TranscriptSegment,
  ExtractedClaim,
} from "@/lib/types";
import { clip, fnv1a, normalizeText, sanitizeUntrusted, splitSentences } from "@/lib/text";
import { publish } from "@/lib/events";
import { applyVerdictPolicy, simulatedVerdict } from "@/lib/verdict/policy";

type GlobalWithWork = typeof globalThis & {
  __veritasActive?: Map<string, Set<Promise<unknown>>>;
};

const MAX_RETRIES = 3;

function activeMap(): Map<string, Set<Promise<unknown>>> {
  const store = globalThis as GlobalWithWork;
  store.__veritasActive ??= new Map();
  return store.__veritasActive;
}

function track(sessionId: string, work: Promise<unknown>): void {
  const map = activeMap();
  const set = map.get(sessionId) ?? new Set<Promise<unknown>>();
  set.add(work);
  map.set(sessionId, set);
  work.finally(() => {
    set.delete(work);
    if (set.size === 0) map.delete(sessionId);
  });
}

export function pendingWork(sessionId: string): number {
  return activeMap().get(sessionId)?.size ?? 0;
}

function createLimiter(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

const limitEvidence = createLimiter(3);

const claimWindows = new Map<string, ClaimWindow>();

function windowFor(sessionId: string): ClaimWindow {
  const existing = claimWindows.get(sessionId);
  if (existing) return existing;
  const created = new ClaimWindow();
  claimWindows.set(sessionId, created);
  return created;
}

function extractedClaim(text: ClaimCandidate, canonical?: CanonicalClaim): ExtractedClaim {
  const quote = clip(text.text, 240);
  const clean = clip(canonical?.statement ?? text.text, 240);
  return {
    text: clean,
    normalizedText: normalizeText(clean),
    quote,
    startMs: text.startMs,
    endMs: text.endMs,
    checkability: "likely_fact",
    searchQueries: canonical?.queries.length ? canonical.queries : buildQueries(clean),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(sessionId: string, event: SessionEvent): void {
  publish(sessionId, event);
}

function evidencePayload(claim: Claim, candidates: EvidenceCandidate[]): Evidence[] {
  const now = new Date().toISOString();
  return candidates.map((candidate, index) => ({
    id: `ev_${claim.id}_${fnv1a(`${candidate.url}:${index}`)}`,
    claimId: claim.id,
    url: candidate.url,
    title: candidate.title,
    publisher: candidate.publisher ?? null,
    publishedAt: candidate.publishedAt ?? null,
    retrievedAt: now,
    excerpt: candidate.excerpt,
    sourceTier: candidate.sourceTier,
    stance: candidate.stance ?? null,
    connector: candidate.connector,
    score: Number((candidates.length - index).toFixed(3)),
    createdAt: now,
  }));
}

function clefState(claim: Claim, evidence: Evidence[]): string {
  return JSON.stringify({
    instruction:
      "Evalúa la afirmación usando SOLO la evidencia adjunta. Si la evidencia no alcanza, dilo. No uses conocimiento externo.",
    claim: claim.text,
    spoken_at_ms: claim.startMs,
    segment_quote: claim.quote,
    evidence: evidence.map((item) => ({
      title: item.title,
      url: item.url,
      publisher: item.publisher,
      published_at: item.publishedAt,
      source_tier: item.sourceTier,
      stance_hint: item.stance,
      excerpt: item.excerpt,
    })),
  });
}

async function callClefWithRetry(
  state: string,
): Promise<{ raw: ClefRawResponse; ms: number }> {
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const raw = await callClefRaw(state, buildQuestions());
      return { raw, ms: Date.now() - started };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ClefError ? error.retryable : false;
      if (!retryable) throw error;
      if (attempt < MAX_RETRIES - 1) await sleep(700 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Clef falló");
}

function answerRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

type Selection = { candidate: ClaimCandidate; gate: GateDiagnostics | null };

/**
 * Chooses the span to publish. Live sessions use the two-question Clef gate;
 * simulated sessions keep the deterministic classifier so the demo runs with
 * no key. Both prefer the longest span that still reads as a finished idea.
 */
async function selectClaimCandidate(candidates: ClaimCandidate[]): Promise<Selection | null> {
  if (candidates.length === 0) return null;
  const config = runtimeConfig();

  if (config.clefMode !== "live") {
    const eligible = gateCandidates(candidates);
    const factual = eligible.filter(
      (candidate) => classifyCheckability(candidate.text) === "likely_fact",
    );
    if (factual.length === 0) return null;
    const widest = factual.reduce((left, right) =>
      right.partCount > left.partCount ? right : left,
    );
    return { candidate: widest, gate: null };
  }

  const result = await runGate(candidates);
  if (!result.selected) return null;
  return {
    candidate: result.selected.candidate,
    gate: {
      closed: Number(result.selected.closed.toFixed(3)),
      factual: Number(result.selected.factual.toFixed(3)),
      score: Number(result.selected.score.toFixed(3)),
      consideredSpans: result.scores.length,
    },
  };
}

async function resolveClaim(claim: Claim, gate: GateDiagnostics | null): Promise<void> {
  const config = runtimeConfig();
  const searching = updateClaimStatus(claim.id, "searching");
  if (searching) emit(claim.sessionId, { type: "claim.updated", claim: searching });

  const bundle = await limitEvidence(() => gatherEvidence(claim, { mode: config.clefMode }));
  const diagnostics: RevisionDiagnostics = {
    connectors: bundle.connectors,
    gate,
    queries: claim.searchQueries,
    rerank: config.rerank,
    droppedByRerank: bundle.droppedByRerank,
  };
  const evidence = evidencePayload(claim, bundle.candidates);
  for (const item of evidence) insertEvidence(item);

  const evaluating = updateClaimStatus(claim.id, "evaluating");
  if (evaluating) emit(claim.sessionId, { type: "claim.updated", claim: evaluating });

  let revision: DecisionRevision;

  if (config.clefMode === "live") {
    const current = getClaim(claim.id) ?? claim;
    const state = clefState(current, evidence);
    const { raw, ms } = await clefQueue.enqueue({
      key: `clef:${claim.id}`,
      priority: 1,
      run: () => callClefWithRetry(state),
    });
    const parsed = parseClefResponse(raw);
    const decision = applyVerdictPolicy({
      clef: parsed,
      evidence: bundle.candidates,
      claimText: current.text,
      checkability: current.checkability,
      evidenceCount: evidence.length,
    });
    revision = {
      id: `rev_${claim.id}_${nextRevisionNumber(claim.id)}`,
      claimId: claim.id,
      revision: nextRevisionNumber(claim.id),
      verdict: decision.verdict,
      confidence: decision.confidence,
      checkableProbability: decision.checkableProbability,
      evidenceQualityScore: decision.evidenceQualityScore,
      needsMoreSourcesProbability: decision.needsMoreSourcesProbability,
      evidenceIds: evidence.map((item) => item.id),
      summary: decision.summary,
      provisional: decision.provisional,
      simulated: false,
      clefMs: ms,
      raw,
      diagnostics,
      createdAt: new Date().toISOString(),
    };
  } else {
    const decision = simulatedVerdict({ evidence: bundle.candidates, corpusEntry: bundle.corpusEntry });
    revision = {
      id: `rev_${claim.id}_${nextRevisionNumber(claim.id)}`,
      claimId: claim.id,
      revision: nextRevisionNumber(claim.id),
      verdict: decision.verdict,
      confidence: decision.confidence,
      checkableProbability: decision.checkableProbability,
      evidenceQualityScore: decision.evidenceQualityScore,
      needsMoreSourcesProbability: decision.needsMoreSourcesProbability,
      evidenceIds: evidence.map((item) => item.id),
      summary: decision.summary,
      provisional: decision.provisional,
      simulated: true,
      clefMs: null,
      raw: { simulated: true, rationale: decision.rationale },
      diagnostics,
      createdAt: new Date().toISOString(),
    };
  }

  insertRevision(revision);
  const resolved = updateClaimStatus(claim.id, "resolved", { resolved: true });
  if (resolved) {
    emit(claim.sessionId, {
      type: "claim.resolved",
      claim: resolved,
      revision,
      evidence: listEvidence(claim.id),
    });
  }
}

async function analyze(claim: Claim, gate: GateDiagnostics | null): Promise<void> {
  try {
    await resolveClaim(claim, gate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de análisis";
    const failed = updateClaimStatus(claim.id, "failed", { error: message, incrementAttempts: true });
    if (failed) emit(failed.sessionId, { type: "claim.failed", claim: failed, error: message });
  }
}

export function analyzeClaim(claim: Claim, gate: GateDiagnostics | null = null): void {
  const work = analyze(claim, gate);
  track(claim.sessionId, work);
}

export type SegmentInput = {
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
};

export async function ingestSegment(input: SegmentInput): Promise<{
  segment: TranscriptSegment;
  claims: Claim[];
} | null> {
  const session = getSession(input.sessionId);
  if (!session) return null;
  if (session.status !== "idle" && session.status !== "capturing") return null;

  const text = sanitizeUntrusted(input.text);
  if (!text) return null;

  const segment: TranscriptSegment = {
    id: `seg_${randomUUID()}`,
    sessionId: session.id,
    seq: nextSegmentSeq(session.id),
    startMs: Math.max(0, Math.round(input.startMs)),
    endMs: Math.max(Math.round(input.endMs), Math.round(input.startMs)),
    text,
    final: true,
    createdAt: new Date().toISOString(),
  };

  const stored = insertSegments([segment])[0];
  if (!stored) return null;

  if (session.status === "idle") {
    const capturing = setSessionStatus(session.id, "capturing");
    if (capturing) emit(session.id, { type: "session.updated", session: capturing });
  }
  emit(session.id, { type: "segment.final", segment: stored });
  const claims: Claim[] = [];
  const now = new Date().toISOString();

  const window = windowFor(session.id);
  let candidates: ClaimCandidate[] = [];
  const utterances = splitSentences(stored.text);
  let cursor = 0;
  for (const utterance of utterances) {
    const index = stored.text.indexOf(utterance, cursor);
    cursor = index >= 0 ? index + utterance.length : cursor + utterance.length;
    const duration = stored.endMs - stored.startMs;
    candidates = window.append({
      text: utterance,
      startMs: Math.round(stored.startMs + duration * (Math.max(0, index) / Math.max(1, stored.text.length))),
      endMs: Math.round(stored.startMs + duration * (Math.min(stored.text.length, cursor) / Math.max(1, stored.text.length))),
    });
  }
  const selection = await selectClaimCandidate(candidates);
  if (selection) {
    const { candidate: selected, gate } = selection;
    const config = runtimeConfig();
    const canonical = config.chatExtractor
      ? await canonicalizeClaim(selected.text, { spokenAtMs: selected.startMs, session })
      : [];
    // An empty canonicalisation is a second opinion that the span holds no
    // usable claim, and publishing the raw words instead produced nonsense
    // like "que está provocando grandísimos daños... señor Fiddle" with the
    // whole sentence as its search query. The reason it used to lose real
    // claims was a 16 s timeout that made it always answer nothing; with that
    // fixed, the verdict is worth trusting. Without a chat extractor the
    // speaker's own words remain the claim.
    const extractedClaims = canonical.length > 0
      ? canonical.map((item) => extractedClaim(selected, item))
      : config.chatExtractor
        ? []
        : [extractedClaim(selected)];
    for (const extracted of extractedClaims) {
      const claim: Claim = {
        id: `clm_${randomUUID()}`,
        sessionId: session.id,
        segmentId: stored.id,
        text: extracted.text,
        normalizedText: extracted.normalizedText,
        quote: extracted.quote,
        startMs: extracted.startMs,
        endMs: extracted.endMs,
        status: "detected",
        checkability: extracted.checkability,
        searchQueries: extracted.searchQueries,
        dedupeKey: fnv1a(extracted.normalizedText),
        attempts: 0,
        error: null,
        detectedAt: now,
        resolvedAt: null,
        updatedAt: now,
      };
      const insertedClaim = insertClaim(claim);
      if (insertedClaim) {
        claims.push(insertedClaim);
        emit(session.id, { type: "claim.detected", claim: insertedClaim });
        analyzeClaim(insertedClaim, gate);
      }
    }
    window.consume(selected);
  }

  emit(session.id, { type: "queue.updated", queue: clefQueue.state() });
  return { segment: stored, claims };
}

export async function finishSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  if (session.status === "finished") return;

  const finishing = setSessionStatus(sessionId, "finishing");
  if (finishing) emit(sessionId, { type: "session.updated", session: finishing });

  // Wait for every analysis started before/while finishing. New segments are
  // rejected once status leaves capturing, so this drains.
  for (let pass = 0; pass < 3; pass += 1) {
    const active = [...(activeMap().get(sessionId) ?? [])];
    if (active.length === 0) break;
    await Promise.allSettled(active);
  }

  const finished = setSessionStatus(sessionId, "finished", { finished: true });
  if (finished) emit(sessionId, { type: "session.updated", session: finished });
  claimWindows.delete(sessionId);
}
