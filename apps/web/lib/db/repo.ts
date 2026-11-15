import { getDb } from "./client";
import type {
  Claim,
  ClaimStatus,
  ClaimWithEvidence,
  DecisionRevision,
  Evidence,
  RevisionDiagnostics,
  Session,
  SessionSnapshot,
  SessionStatus,
  SourceTier,
  Stance,
  TranscriptSegment,
  Verdict,
  Checkability,
  SourceType,
} from "@/lib/types";
import { runtimeConfig } from "@/lib/config";
import { clefQueue } from "@/lib/clef/queue";

type Row = Record<string, unknown>;

const num = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string => String(value ?? "");
const nullable = (value: unknown): string | null => (value == null ? null : String(value));
const bool = (value: unknown): boolean => Number(value ?? 0) === 1;

function mapSession(row: Row): Session {
  return {
    id: str(row.id),
    sourceType: str(row.source_type) as SourceType,
    status: str(row.status) as SessionStatus,
    fixtureId: nullable(row.fixture_id),
    createdAt: str(row.created_at),
    finishedAt: nullable(row.finished_at),
    error: nullable(row.error),
  };
}

function mapSegment(row: Row): TranscriptSegment {
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    seq: num(row.seq),
    startMs: num(row.start_ms),
    endMs: num(row.end_ms),
    text: str(row.text),
    final: bool(row.final),
    createdAt: str(row.created_at),
  };
}

function mapClaim(row: Row): Claim {
  let queries: string[] = [];
  try {
    const parsed = JSON.parse(str(row.search_queries) || "[]") as unknown;
    if (Array.isArray(parsed)) queries = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    queries = [];
  }
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    segmentId: str(row.segment_id),
    text: str(row.text),
    normalizedText: str(row.normalized_text),
    quote: str(row.quote),
    startMs: num(row.start_ms),
    endMs: num(row.end_ms),
    status: str(row.status) as ClaimStatus,
    checkability: str(row.checkability) as Checkability,
    searchQueries: queries,
    dedupeKey: str(row.dedupe_key),
    attempts: num(row.attempts),
    error: nullable(row.error),
    detectedAt: str(row.detected_at),
    resolvedAt: nullable(row.resolved_at),
    updatedAt: str(row.updated_at),
  };
}

function mapEvidence(row: Row): Evidence {
  return {
    id: str(row.id),
    claimId: str(row.claim_id),
    url: str(row.url),
    title: str(row.title),
    publisher: nullable(row.publisher),
    publishedAt: nullable(row.published_at),
    retrievedAt: str(row.retrieved_at),
    excerpt: str(row.excerpt),
    sourceTier: str(row.source_tier) as SourceTier,
    stance: (nullable(row.stance) as Stance | null) ?? null,
    connector: str(row.connector),
    score: num(row.score),
    createdAt: str(row.created_at),
  };
}

function mapRevision(row: Row): DecisionRevision {
  let evidenceIds: string[] = [];
  try {
    const parsed = JSON.parse(str(row.evidence_ids) || "[]") as unknown;
    if (Array.isArray(parsed)) evidenceIds = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    evidenceIds = [];
  }
  let raw: unknown = null;
  try {
    raw = row.raw ? JSON.parse(str(row.raw)) : null;
  } catch {
    raw = null;
  }
  let diagnostics: RevisionDiagnostics | null = null;
  try {
    diagnostics = row.diagnostics ? (JSON.parse(str(row.diagnostics)) as RevisionDiagnostics) : null;
  } catch {
    diagnostics = null;
  }
  return {
    id: str(row.id),
    claimId: str(row.claim_id),
    revision: num(row.revision),
    verdict: str(row.verdict) as Verdict,
    confidence: num(row.confidence),
    checkableProbability: num(row.checkable_probability),
    evidenceQualityScore: num(row.evidence_quality_score),
    needsMoreSourcesProbability: num(row.needs_more_sources_probability),
    evidenceIds,
    summary: str(row.summary),
    provisional: bool(row.provisional),
    simulated: bool(row.simulated),
    clefMs: row.clef_ms == null ? null : num(row.clef_ms),
    raw,
    diagnostics,
    createdAt: str(row.created_at),
  };
}

export function createSession(input: {
  id: string;
  sourceType: SourceType;
  fixtureId?: string | null;
}): Session {
  const db = getDb();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, source_type, status, fixture_id, created_at, finished_at, error)
     VALUES (?, ?, 'idle', ?, ?, NULL, NULL)`,
  ).run(input.id, input.sourceType, input.fixtureId ?? null, createdAt);
  return {
    id: input.id,
    sourceType: input.sourceType,
    status: "idle",
    fixtureId: input.fixtureId ?? null,
    createdAt,
    finishedAt: null,
    error: null,
  };
}

export function getSession(id: string): Session | null {
  const row = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  return row ? mapSession(row as Row) : null;
}

/** A session with no traffic for this long was abandoned, not captured. */
const STALE_SESSION_MS = 10 * 60_000;

/**
 * Closes sessions left open by a reload, a closed tab or a crash. Without this
 * every abandoned capture stayed "capturing" for ever: the live database had
 * fifteen of them, which makes the session list useless and keeps accepting
 * segments for a capture nobody is watching.
 */
/**
 * Publisher tiers survive restarts on purpose: classifying a domain costs a
 * model call, and the same outlets come back capture after capture.
 */
export function getPublisherTier(host: string): SourceTier | null {
  const row = getDb().prepare("SELECT tier FROM publishers WHERE host = ?").get(host) as Row | undefined;
  const tier = row ? str(row.tier) : "";
  return tier === "primary" || tier === "reliable_secondary" || tier === "other" ? tier : null;
}

export function setPublisherTier(host: string, tier: SourceTier): void {
  getDb()
    .prepare(
      "INSERT INTO publishers (host, tier, created_at) VALUES (?, ?, ?)" +
        " ON CONFLICT(host) DO UPDATE SET tier = excluded.tier",
    )
    .run(host, tier, new Date().toISOString());
}

export function closeStaleSessions(now = Date.now()): number {
  const cutoff = new Date(now - STALE_SESSION_MS).toISOString();
  const result = getDb()
    .prepare(
      `UPDATE sessions
          SET status = 'finished',
              finished_at = COALESCE(finished_at, ?),
              error = COALESCE(error, 'Sesión cerrada automáticamente: la captura se abandonó.')
        WHERE status IN ('idle', 'capturing', 'finishing')
          AND COALESCE(
                (SELECT MAX(s.created_at) FROM segments s WHERE s.session_id = sessions.id),
                sessions.created_at
              ) < ?`,
    )
    .run(new Date(now).toISOString(), cutoff);
  return Number(result.changes);
}

export function setSessionStatus(
  id: string,
  status: SessionStatus,
  options: { error?: string | null; finished?: boolean } = {},
): Session | null {
  const db = getDb();
  const finishedAt = options.finished ? new Date().toISOString() : null;
  db.prepare(
    `UPDATE sessions SET status = ?, error = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?`,
  ).run(status, options.error ?? null, finishedAt, id);
  return getSession(id);
}

export function insertSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const db = getDb();
  const inserted: TranscriptSegment[] = [];
  const statement = db.prepare(
    `INSERT OR IGNORE INTO segments (id, session_id, seq, start_ms, end_ms, text, final, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const segment of segments) {
    const result = statement.run(
      segment.id,
      segment.sessionId,
      segment.seq,
      segment.startMs,
      segment.endMs,
      segment.text,
      segment.final ? 1 : 0,
      segment.createdAt,
    );
    if (Number(result.changes) > 0) inserted.push(segment);
  }
  return inserted;
}

export function listSegments(sessionId: string): TranscriptSegment[] {
  const rows = getDb()
    .prepare("SELECT * FROM segments WHERE session_id = ? ORDER BY seq ASC, start_ms ASC")
    .all(sessionId) as Row[];
  return rows.map(mapSegment);
}

export function nextSegmentSeq(sessionId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM segments WHERE session_id = ?")
    .get(sessionId) as Row | undefined;
  return num(row?.next ?? 0);
}

export function insertClaim(claim: Claim): Claim | null {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO claims (
        id, session_id, segment_id, text, normalized_text, quote, start_ms, end_ms, status,
        checkability, search_queries, dedupe_key, attempts, error, detected_at, resolved_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      claim.id,
      claim.sessionId,
      claim.segmentId,
      claim.text,
      claim.normalizedText,
      claim.quote,
      claim.startMs,
      claim.endMs,
      claim.status,
      claim.checkability,
      JSON.stringify(claim.searchQueries),
      claim.dedupeKey,
      claim.attempts,
      claim.error,
      claim.detectedAt,
      claim.resolvedAt,
      claim.updatedAt,
    );
  return Number(result.changes) > 0 ? claim : null;
}

export function updateClaimStatus(
  id: string,
  status: ClaimStatus,
  options: { error?: string | null; resolved?: boolean; incrementAttempts?: boolean } = {},
): Claim | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE claims SET status = ?, error = ?, updated_at = ?,
       resolved_at = CASE WHEN ? = 1 THEN ? ELSE resolved_at END,
       attempts = attempts + ?
     WHERE id = ?`,
  ).run(
    status,
    options.error ?? null,
    now,
    options.resolved ? 1 : 0,
    now,
    options.incrementAttempts ? 1 : 0,
    id,
  );
  return getClaim(id);
}

export function getClaim(id: string): Claim | null {
  const row = getDb().prepare("SELECT * FROM claims WHERE id = ?").get(id);
  return row ? mapClaim(row as Row) : null;
}

export function listClaims(sessionId: string): Claim[] {
  const rows = getDb()
    .prepare("SELECT * FROM claims WHERE session_id = ? ORDER BY start_ms ASC, detected_at ASC")
    .all(sessionId) as Row[];
  return rows.map(mapClaim);
}

export function listClaimsWithEvidence(sessionId: string): ClaimWithEvidence[] {
  return listClaims(sessionId).map((claim) => ({
    ...claim,
    evidence: listEvidence(claim.id),
    revisions: listRevisions(claim.id),
  }));
}

export function countOpenClaims(sessionId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total FROM claims WHERE session_id = ? AND status IN ('detected','searching','evaluating')`,
    )
    .get(sessionId) as Row | undefined;
  return num(row?.total ?? 0);
}

export function pendingClaims(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM claims WHERE status IN ('detected','searching','evaluating')`)
    .get() as Row | undefined;
  return num(row?.total ?? 0);
}

export function insertEvidence(evidence: Evidence): Evidence | null {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO evidence (
        id, claim_id, url, title, publisher, published_at, retrieved_at, excerpt,
        source_tier, stance, connector, score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      evidence.id,
      evidence.claimId,
      evidence.url,
      evidence.title,
      evidence.publisher,
      evidence.publishedAt,
      evidence.retrievedAt,
      evidence.excerpt,
      evidence.sourceTier,
      evidence.stance,
      evidence.connector,
      evidence.score,
      evidence.createdAt,
    );
  return Number(result.changes) > 0 ? evidence : null;
}

export function listEvidence(claimId: string): Evidence[] {
  const rows = getDb()
    .prepare("SELECT * FROM evidence WHERE claim_id = ? ORDER BY score DESC, created_at ASC")
    .all(claimId) as Row[];
  return rows.map(mapEvidence);
}

export function insertRevision(revision: DecisionRevision): DecisionRevision {
  getDb()
    .prepare(
      `INSERT INTO revisions (
        id, claim_id, revision, verdict, confidence, checkable_probability,
        evidence_quality_score, needs_more_sources_probability, evidence_ids,
        summary, provisional, simulated, clef_ms, raw, diagnostics, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      revision.id,
      revision.claimId,
      revision.revision,
      revision.verdict,
      revision.confidence,
      revision.checkableProbability,
      revision.evidenceQualityScore,
      revision.needsMoreSourcesProbability,
      JSON.stringify(revision.evidenceIds),
      revision.summary,
      revision.provisional ? 1 : 0,
      revision.simulated ? 1 : 0,
      revision.clefMs,
      revision.raw ? JSON.stringify(revision.raw) : null,
      revision.diagnostics ? JSON.stringify(revision.diagnostics) : null,
      revision.createdAt,
    );
  return revision;
}

export function listRevisions(claimId: string): DecisionRevision[] {
  const rows = getDb()
    .prepare("SELECT * FROM revisions WHERE claim_id = ? ORDER BY revision ASC")
    .all(claimId) as Row[];
  return rows.map(mapRevision);
}

export function latestRevision(claimId: string): DecisionRevision | null {
  const row = getDb()
    .prepare("SELECT * FROM revisions WHERE claim_id = ? ORDER BY revision DESC LIMIT 1")
    .get(claimId);
  return row ? mapRevision(row as Row) : null;
}

export function nextRevisionNumber(claimId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM revisions WHERE claim_id = ?")
    .get(claimId) as Row | undefined;
  return num(row?.next ?? 1);
}

export function snapshot(sessionId: string): SessionSnapshot | null {
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    session,
    segments: listSegments(sessionId),
    claims: listClaimsWithEvidence(sessionId),
    queue: clefQueue.state(),
    config: runtimeConfig(),
  };
}

export function sessionExists(id: string): boolean {
  return getSession(id) != null;
}
