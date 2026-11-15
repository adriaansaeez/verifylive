export type SourceType = "tab" | "mic" | "local_file" | "fixture";

export type SessionStatus = "idle" | "capturing" | "finishing" | "finished" | "failed";

export type ClaimStatus = "detected" | "searching" | "evaluating" | "resolved" | "failed";

export type Verdict = "supported" | "contradicted" | "misleading" | "unverifiable";

export type SourceTier = "primary" | "reliable_secondary" | "other";

export type Stance = "supports" | "contradicts" | "context";

export type Checkability = "likely_fact" | "likely_opinion" | "unclear";

export type ClefMode = "live" | "simulated";

export type Session = {
  id: string;
  sourceType: SourceType;
  status: SessionStatus;
  fixtureId: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type TranscriptSegment = {
  id: string;
  sessionId: string;
  seq: number;
  startMs: number;
  endMs: number;
  text: string;
  final: boolean;
  createdAt: string;
};

export type Claim = {
  id: string;
  sessionId: string;
  segmentId: string;
  text: string;
  normalizedText: string;
  quote: string;
  startMs: number;
  endMs: number;
  status: ClaimStatus;
  checkability: Checkability;
  searchQueries: string[];
  dedupeKey: string;
  attempts: number;
  error: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
};

export type Evidence = {
  id: string;
  claimId: string;
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  excerpt: string;
  sourceTier: SourceTier;
  stance: Stance | null;
  connector: string;
  score: number;
  createdAt: string;
};

/** One evidence connector run: what we asked, what came back, how long it took. */
export type ConnectorReport = {
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
};

/** Gate probabilities for the published span. Lets the threshold be calibrated
 * from real sessions instead of by eye. */
export type GateDiagnostics = {
  closed: number;
  factual: number;
  score: number;
  consideredSpans: number;
};

/**
 * Why a verdict looks the way it does. Without this an empty evidence list and
 * a dead search provider are indistinguishable in the UI.
 */
export type RevisionDiagnostics = {
  connectors: ConnectorReport[];
  gate: GateDiagnostics | null;
  queries: string[];
  rerank: "nan" | "local";
  droppedByRerank: number;
};

export type DecisionRevision = {
  id: string;
  claimId: string;
  revision: number;
  verdict: Verdict;
  confidence: number;
  checkableProbability: number;
  evidenceQualityScore: number;
  needsMoreSourcesProbability: number;
  evidenceIds: string[];
  summary: string;
  provisional: boolean;
  simulated: boolean;
  clefMs: number | null;
  raw: unknown;
  diagnostics: RevisionDiagnostics | null;
  createdAt: string;
};

export type ClaimWithEvidence = Claim & {
  evidence: Evidence[];
  revisions: DecisionRevision[];
};

export type QueueState = {
  inFlight: number;
  waiting: number;
  completed: number;
  failed: number;
  lastWaitMs: number | null;
};

export type RuntimeConfig = {
  clefMode: ClefMode;
  chatExtractor: boolean;
  rerank: "nan" | "local";
  wikipedia: boolean;
  jina: boolean;
  cloudEvidence: boolean;
  search: "searxng" | "google" | "brave" | "bingnews" | "bing" | "gdelt" | null;
};

export type SessionSnapshot = {
  session: Session;
  segments: TranscriptSegment[];
  claims: ClaimWithEvidence[];
  queue: QueueState;
  config: RuntimeConfig;
};

export type ExtractedClaim = {
  text: string;
  normalizedText: string;
  quote: string;
  startMs: number;
  endMs: number;
  checkability: Checkability;
  searchQueries: string[];
};

export type EvidenceCandidate = {
  url: string;
  title: string;
  publisher?: string | null;
  publishedAt?: string | null;
  excerpt: string;
  sourceTier: SourceTier;
  stance?: Stance | null;
  connector: string;
};

export type SessionEvent =
  | { type: "session.updated"; session: Session }
  | { type: "segment.final"; segment: TranscriptSegment }
  | { type: "claim.detected"; claim: Claim }
  | { type: "claim.updated"; claim: Claim }
  | { type: "claim.resolved"; claim: Claim; revision: DecisionRevision; evidence: Evidence[] }
  | { type: "claim.failed"; claim: Claim; error: string }
  | { type: "queue.updated"; queue: QueueState }
  | { type: "snapshot"; snapshot: SessionSnapshot };
