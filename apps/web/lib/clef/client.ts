import { CLEF_TIMEOUT_MS, CLEF_URL } from "@/lib/config";
import type { Verdict } from "@/lib/types";
import { clamp01 } from "@/lib/text";

export type ClefQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type ClefRawResponse = {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type ParsedClef = {
  verdict: Verdict;
  verdictProbabilities: Record<string, number>;
  verdictConfidence: number;
  checkableProbability: number;
  evidenceQualityScore: number;
  needsMoreSourcesProbability: number;
  /** Would two reporters with these sources agree? */
  settleableProbability: number;
  usage: ClefRawResponse["usage"];
  raw: ClefRawResponse;
};

export class ClefError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ClefError";
    this.status = status;
    this.retryable = retryable;
  }
}

const VERDICTS: Verdict[] = ["supported", "contradicted", "misleading", "unverifiable"];

export const VERDICT_CRITERIA: Record<Verdict, string> = {
  supported: "Reliable evidence directly supports the factual claim",
  contradicted: "Reliable evidence directly contradicts the factual claim",
  misleading:
    "A true fragment of the claim omits context that materially changes its meaning",
  unverifiable:
    "Evidence is insufficient, irrelevant or conflicting, or the statement is not a factual claim",
};

const QUALITY_LEVELS = [
  "None: no usable evidence",
  "Weak: tangential or undated sources",
  "Mixed: some support and some contradiction",
  "Strong: recent, relevant and consistent sources",
  "Primary and conclusive: official or first-hand record",
];

function numberFrom(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function probabilityMap(value: unknown): Record<string, number> {
  const record = recordFrom(value);
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) output[key] = entry;
  }
  return output;
}

export function parseClefResponse(payload: ClefRawResponse): ParsedClef {
  const answers = recordFrom(payload.answers);
  const verdictAnswer = recordFrom(answers.verdict);
  const choiceRaw = String(verdictAnswer.choice ?? "");
  const verdict = (VERDICTS as string[]).includes(choiceRaw)
    ? (choiceRaw as Verdict)
    : "unverifiable";
  const verdictProbabilities = probabilityMap(verdictAnswer.probabilities);
  const fallbackConfidence = verdictProbabilities[verdict] ?? 0;
  const qualityAnswer = recordFrom(answers.evidence_quality);
  const qualityRaw = numberFrom(qualityAnswer.score, 0);
  const needsMore = numberFrom(recordFrom(answers.needs_more_sources).noul, 1);

  return {
    verdict,
    verdictProbabilities,
    verdictConfidence: clamp01(numberFrom(verdictAnswer.confidence, fallbackConfidence)),
    checkableProbability: clamp01(numberFrom(recordFrom(answers.is_checkable).noul, 0)),
    evidenceQualityScore: Math.min(4, Math.max(0, qualityRaw)),
    needsMoreSourcesProbability: clamp01(needsMore),
    // Absent in an older response: assume settleable rather than invent a
    // caveat the model never expressed.
    settleableProbability: clamp01(
      numberFrom(recordFrom(answers.is_settleable).noul, 1),
    ),
    usage: payload.usage,
    raw: payload,
  };
}

/** Single raw call with timeout. Retries and ordering live in the queue. */
export async function callClefRaw(
  state: string,
  questions: Record<string, ClefQuestion>,
  options: { signal?: AbortSignal } = {},
): Promise<ClefRawResponse> {
  const key = process.env.NAN_KEY?.trim();
  if (!key) throw new ClefError("NAN_KEY is not configured", 0, false);

  const timeout = AbortSignal.timeout(CLEF_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(CLEF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "clef", state, questions }),
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const retryable = response.status === 429 || response.status === 502 || response.status === 504;
    throw new ClefError(
      `Clef HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      response.status,
      retryable,
    );
  }

  return (await response.json()) as ClefRawResponse;
}

export function buildQuestions(): Record<string, ClefQuestion> {
  return {
    verdict: {
      type: "choice",
      instructions:
        "What verdict is justified only by the supplied evidence? Choose one option; never rely on outside knowledge.",
      criteria: VERDICT_CRITERIA,
    },
    is_checkable: {
      type: "noul",
      instructions:
        "Is this a concrete factual claim rather than an opinion, prediction, joke or value judgment?",
    },
    evidence_quality: {
      type: "score",
      instructions: "How strong and directly relevant is the supplied evidence?",
      criteria: QUALITY_LEVELS,
    },
    needs_more_sources: {
      type: "noul",
      instructions: "Would responsible verification require more or better sources?",
    },
    // Two observers with the same sources in front of them should reach the
    // same answer. "Los servicios públicos empeoran" has evidence available
    // and still fails this: deciding it would be a judgment call. Asked here,
    // on the normalised claim, rather than in the gate, where the raw ASR
    // span still carries its framing and the signal does not survive.
    is_settleable: {
      type: "noul",
      instructions:
        "If two reporters with these same sources had to decide whether this claim is true or false, would they reach the same conclusion? " +
        "Answer high when the claim states something definite: a quantity, a date, a specific act, something that did or did not happen. " +
        "Answer low when the answer would depend on each reporter's interpretation, because it is a value judgment, a metaphor or a disputable causal link.",
    },
  };
}

export function qualityLabel(score: number): string {
  const labels = ["Ninguna", "Débil", "Mixta", "Sólida", "Primaria y concluyente"];
  const index = Math.min(4, Math.max(0, Math.round(score)));
  return labels[index] ?? "Ninguna";
}
