import type { CorpusEntry } from "@/lib/fixtures";
import type { Checkability, EvidenceCandidate, Verdict, ClefMode } from "@/lib/types";
import { clamp01 } from "@/lib/text";
import type { ParsedClef } from "@/lib/clef/client";
import { claimAnchors } from "@/lib/claims/anchors";
import { qualityLabel } from "@/lib/clef/client";
import { MIN_CHECKABLE, MIN_CONFIDENCE, PROVISIONAL_NEEDS_MORE } from "@/lib/config";
import { applyNumericCheck } from "@/lib/verdict/numeric";
import { checkSuperlative } from "@/lib/verdict/superlative";
import { distinctPublishers, publisherKey } from "@/lib/evidence/sources";

const MAX_CONFIDENCE = 0.95;

export type FinalVerdict = {
  verdict: Verdict;
  confidence: number;
  provisional: boolean;
  simulated: boolean;
  mode: ClefMode;
  checkableProbability: number;
  evidenceQualityScore: number;
  needsMoreSourcesProbability: number;
  summary: string;
  rationale: string;
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  supported: "Respaldada",
  contradicted: "Contradicha",
  misleading: "Engañosa",
  unverifiable: "No verificable",
};

export const VERDICT_SUMMARIES: Record<Verdict, string> = {
  supported: "Las fuentes consultadas respaldan la afirmación.",
  contradicted: "Las fuentes consultadas contradicen la afirmación.",
  misleading: "Parte de la afirmación es cierta, pero el contexto cambia su significado.",
  unverifiable: "No hay evidencia suficiente para confirmar ni refutar la afirmación.",
};

function sourceNote(evidence: EvidenceCandidate[]): string {
  if (evidence.length === 0) return "Sin evidencia recuperada.";
  const primary = evidence.filter((item) => item.sourceTier === "primary").length;
  const secondary = evidence.filter((item) => item.sourceTier === "reliable_secondary").length;
  const parts = [`${evidence.length} fuente(s) de ${distinctPublishers(evidence)} medio(s)`];
  if (primary > 0) parts.push(`${primary} primaria(s)`);
  if (secondary > 0) parts.push(`${secondary} secundaria(s) fiables`);
  if (primary === 0) parts.push("sin fuente primaria");
  return `${parts.join(", ")}.`;
}

/** Confidence ceiling when every source is an unvetted site. */
const UNVETTED_SOURCE_CONFIDENCE = 0.6;

/** Confidence ceiling for a claim too vague to be settled either way. */
const VAGUE_CLAIM_CONFIDENCE = 0.6;

/**
 * A claim worth a firm verdict names something: a figure, a date or an entity.
 * With no claim text to read, the rule abstains rather than assuming the worst.
 */
function isSpecificEnough(claimText: string): boolean {
  const text = claimText.trim();
  if (!text) return true;
  return claimAnchors(text).length > 0;
}

/** At least one primary source or recognised outlet. */
function hasReliableSource(evidence: EvidenceCandidate[]): boolean {
  return evidence.some(
    (item) => item.sourceTier === "primary" || item.sourceTier === "reliable_secondary",
  );
}

function capConfidence(clef: ParsedClef, evidence: EvidenceCandidate[]): number {
  const hasPrimary = evidence.some((item) => item.sourceTier === "primary");
  const cap = 0.5 + clef.evidenceQualityScore * 0.08 + evidence.length * 0.05 + (hasPrimary ? 0.05 : 0);
  return Math.min(MAX_CONFIDENCE, Math.max(0, cap));
}

/**
 * Policy layer between Clef and the UI. Clef never gets the last word alone:
 * low checkability, weak evidence or "needs more sources" always surfaces as
 * provisional instead of a confident verdict.
 */
export function applyVerdictPolicy(input: {
  clef: ParsedClef;
  evidence: EvidenceCandidate[];
  claimText?: string;
  checkability?: Checkability;
  evidenceCount?: number;
}): FinalVerdict {
  const { clef, evidence } = input;
  let verdict = clef.verdict;
  let provisional = false;
  let confidence = Math.min(clef.verdictConfidence, capConfidence(clef, evidence));
  let rationale = "";

  if (clef.checkableProbability < MIN_CHECKABLE) {
    verdict = "unverifiable";
    provisional = true;
    confidence = clamp01(1 - clef.checkableProbability);
    rationale = `La afirmación no parece verificable (probabilidad de ser factual: ${clef.checkableProbability.toFixed(2)}).`;
  } else if (
    clef.needsMoreSourcesProbability >= PROVISIONAL_NEEDS_MORE ||
    clef.evidenceQualityScore < 2 ||
    evidence.length < 2 ||
    distinctPublishers(evidence) < 2
  ) {
    verdict = "unverifiable";
    provisional = true;
    confidence = Math.min(0.6, 0.35 + clef.evidenceQualityScore * 0.05 + evidence.length * 0.03);
    rationale = `Evidencia insuficiente: calidad ${qualityLabel(clef.evidenceQualityScore).toLowerCase()}, ${sourceNote(evidence)}`;
  } else {
    rationale = `Clef evaluó ${sourceNote(evidence)} Calidad de evidencia: ${qualityLabel(clef.evidenceQualityScore)}.`;
    if (verdict === "unverifiable") provisional = true;
    if (confidence < MIN_CONFIDENCE) provisional = true;
    // Source count was the only bar, so three SEO blogs about working in
    // Switzerland produced a firm "respaldada" at 0.85. A verdict is never
    // concluyente without at least one source we are willing to stand behind.
    if (!hasReliableSource(evidence)) {
      provisional = true;
      confidence = Math.min(confidence, UNVETTED_SOURCE_CONFIDENCE);
      rationale = `${rationale} Ninguna fuente es primaria ni un medio de referencia, así que el veredicto queda provisional.`;
    }
    // A claim with no figure, date or name is not precise enough to settle.
    // Measured on real captures: "los servicios públicos empeoran" and "tener
    // un trabajo ya no garantiza llegar a fin de mes" were being published as
    // firm "respaldada", while "cada año se forman 240.000 familias" and "la
    // UCA Hogar Joven permite aportar 2.000 euros" carry an anchor and stay
    // firm.
    if (!isSpecificEnough(input.claimText ?? "")) {
      provisional = true;
      confidence = Math.min(confidence, VAGUE_CLAIM_CONFIDENCE);
      rationale = `${rationale} La afirmación no cita ninguna cifra, fecha ni entidad concreta, así que no puede darse por zanjada.`;
    }
  }

  const numeric = applyNumericCheck({
    verdict,
    confidence,
    provisional,
    rationale,
    claimText: input.claimText ?? "",
    checkability: input.checkability ?? "unclear",
    evidence: evidence.map((item) => ({
      stance: item.stance ?? null,
      excerpt: item.excerpt,
      sourceKey: publisherKey(item),
    })),
    evidenceCount: input.evidenceCount ?? evidence.length,
    distinctSourceCount: distinctPublishers(evidence),
  });
  verdict = numeric.verdict;
  confidence = clamp01(Math.min(numeric.confidence, MAX_CONFIDENCE));
  provisional = numeric.provisional;
  rationale = numeric.rationale;

  // A number can be right while "un récord histórico" is not: sources that
  // confirm 500.000 jobs rarely confirm the record. Downgrade instead of
  // letting the LLM's confidence cover an unsupported superlative.
  if (verdict === "supported" && (input.claimText ?? "")) {
    const superlative = checkSuperlative(
      input.claimText ?? "",
      evidence.map((item) => item.excerpt),
    );
    if (superlative === "unsupported") {
      verdict = "misleading";
      confidence = clamp01(Math.max(confidence, 0.72));
      rationale = `${rationale} · el superlativo de la frase no aparece en las fuentes consultadas.`;
    }
  }

  // The reader sees the summary, not the rationale, so the caveat about
  // unvetted sources has to travel with it.
  const caveats = [
    evidence.length > 0 && !hasReliableSource(evidence)
      ? "Ninguna fuente es primaria ni un medio de referencia: veredicto provisional."
      : "",
    !isSpecificEnough(input.claimText ?? "")
      ? "Sin cifras, fechas ni entidades concretas, la afirmación no puede darse por zanjada."
      : "",
  ].filter(Boolean).join(" ");
  const summary = `${VERDICT_SUMMARIES[verdict]} ${sourceNote(evidence)}${caveats ? ` ${caveats}` : ""}`.trim();

  return {
    verdict,
    confidence: Number(confidence.toFixed(3)),
    provisional,
    simulated: false,
    mode: "live",
    checkableProbability: clef.checkableProbability,
    evidenceQualityScore: clef.evidenceQualityScore,
    needsMoreSourcesProbability: clef.needsMoreSourcesProbability,
    summary,
    rationale,
  };
}

/**
 * Deterministic fallback used when NAN_KEY is absent. It never pretends to be
 * Clef: `simulated` is true, the UI shows a badge, and stances are local.
 */
export function simulatedVerdict(input: {
  evidence: EvidenceCandidate[];
  corpusEntry: CorpusEntry | null;
}): FinalVerdict {
  const { evidence, corpusEntry } = input;

  const supports = evidence.filter((item) => item.stance === "supports").length;
  const contradicts = evidence.filter((item) => item.stance === "contradicts").length;
  const tierScore = evidence.reduce((total, item) => {
    if (item.sourceTier === "primary") return total + 4;
    if (item.sourceTier === "reliable_secondary") return total + 3;
    return total + 1;
  }, 0);
  const evidenceQualityScore = evidence.length > 0 ? Math.min(4, tierScore / evidence.length) : 0;

  let verdict: Verdict = "unverifiable";
  let confidence = 0.3;
  let provisional = true;
  let rationale = "Modo simulado: no hay NAN_KEY, así que no se llamó a Clef.";

  if (corpusEntry) {
    verdict = corpusEntry.expectedVerdict;
    confidence = 0.72;
    provisional = false;
    rationale = `Modo simulado: veredicto esperado del corpus curado (${corpusEntry.id}). ${corpusEntry.rationale}`;
  } else if (supports > 0 && contradicts > 0) {
    verdict = "misleading";
    confidence = 0.5;
    rationale = "Modo simulado: las fuentes recuperadas se contradicen entre sí.";
  } else if (supports >= 2 && contradicts === 0) {
    verdict = "supported";
    confidence = 0.45;
    rationale = "Modo simulado: varias fuentes recuperadas coinciden con la afirmación.";
  } else if (contradicts >= 2 && supports === 0) {
    verdict = "contradicted";
    confidence = 0.45;
    rationale = "Modo simulado: varias fuentes recuperadas contradicen la afirmación.";
  } else {
    rationale += ` Evidencia insuficiente (${sourceNote(evidence)})`;
  }

  const summary = `${VERDICT_SUMMARIES[verdict]} ${sourceNote(evidence)} (simulado)`.trim();

  return {
    verdict,
    confidence,
    provisional,
    simulated: true,
    mode: "simulated",
    checkableProbability: 0.7,
    evidenceQualityScore: Number(evidenceQualityScore.toFixed(2)),
    needsMoreSourcesProbability: evidence.length < 2 ? 1 : 0.5,
    summary,
    rationale,
  };
}
