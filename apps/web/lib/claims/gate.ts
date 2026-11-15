import { callClefRaw, type ClefQuestion } from "@/lib/clef/client";
import { clefQueue } from "@/lib/clef/queue";
import type { ClaimCandidate } from "@/lib/claims/claim-window";
import { isSpeechAct } from "@/lib/claims/heuristic";
import { clamp01, fnv1a, tokenize } from "@/lib/text";

/**
 * Claim gate.
 *
 * A single "is this a checkable claim?" question collapsed towards zero on ASR
 * text and, worse, scored a truncated fragment ("Yo he inaugurado pues el ave
 * madrid", 0.56) above the complete sentence that contained it (0.23), so the
 * pipeline published cut claims and dropped the rest. Two independent
 * questions fix both halves:
 *
 * - `closed`  did the idea finish inside this span? Judges the END only,
 *             because an ASR cut decides where a span starts, not the speaker.
 * - `factual` is there a checkable fact underneath, hedges ignored?
 *
 * Measured on the captured rail interview, the truncated fragment drops to
 * 0.02 while its full span rises to 0.88.
 */

/**
 * Thresholds calibrated on two real captures.
 *
 * On the rail interview a 0.10 factual floor published 23 spans, five of which
 * were not claims: an opinion about how Europe saw Spain (0.20), a framing
 * remark (0.27), a question about whether trains are better now (0.35) and a
 * garbled anecdote (0.40).
 *
 * On a live debate capture the remaining noise sat just above a 0.45 floor:
 * rhetoric the ASR had mangled ("servicios de Pakistán", 0.50), the
 * moderator closing a turn (0.46) and two garbled fragments (0.53, 0.55),
 * while every genuine claim scored 0.67 or higher: six million migrants
 * (0.78), the assault on a 14-year-old (0.91), the wealth of the richest 1%
 * (0.67). A 0.6 floor separates the two groups on both captures.
 */
export const GATE_MIN_CLOSED = 0.5;
export const GATE_MIN_FACTUAL = 0.6;
export const GATE_MIN_SCORE = 0.3;

/**
 * The gate deliberately does NOT judge precision.
 *
 * Measured: on a raw ASR span the question cannot tell rhetoric from a real
 * claim, because the span still carries its framing. "creo también que es
 * justo decir que el sistema ferroviario es un sistema seguro" scores 0.024
 * and "los servicios públicos empeoran" scores 0.056, so filtering here lost
 * two of the six reference claims. Precision is judged in the verdict
 * instead, where the text has already been normalised.
 */
/** Below this gap two spans are equally good, so the longer one wins. */
export const GATE_TIE_MARGIN = 0.2;

export type GateScore = {
  candidate: ClaimCandidate;
  closed: number;
  factual: number;
  /** Does it name something definite? */
  concrete: number;
  /** Would two reporters with the same data reach the same conclusion? */
  agreed: number;
  /** concrete x agreed. */
  precision: number;
  score: number;
};

const GATE_CONTEXT =
  "Fragmentos consecutivos de una transcripción automática en español. El reconocimiento de voz puntúa mal, deja muletillas y repeticiones, y escribe los nombres propios en minúscula. Un fragmento puede empezar a mitad de frase porque el corte lo decide el audio, no el hablante. Juzga el contenido, nunca la ortografía.";

function closedQuestion(text: string): ClefQuestion {
  return {
    type: "noul",
    instructions:
      `Fragmento «${text}». ¿La idea principal llega hasta el final, es decir, el fragmento NO se corta antes de terminar lo que se estaba diciendo? ` +
      "Da igual que empiece a mitad de frase: juzga solo el final. " +
      "Responde alto si lo que se afirma queda dicho por completo. " +
      "Responde bajo si el final queda suspendido, por ejemplo si acaba en conjunción, preposición, artículo, o en una enumeración que claramente sigue.",
  };
}

function factualQuestion(text: string): ClefQuestion {
  return {
    type: "noul",
    instructions:
      `Fragmento «${text}». Ignora muletillas y marcos como «creo que», «es justo decir», «evidentemente» o «fíjate»: juzga el hecho que se afirma por debajo. ` +
      "¿Afirma algo concreto sobre el mundo que otra persona podría comprobar en datos, registros o documentos públicos? " +
      "Responde alto para cifras, fechas, comparaciones, cantidades, hechos sobre lo que ha ocurrido y descripciones de cómo son las cosas. " +
      "Responde bajo solo si es una pregunta, un saludo, una propuesta, un deseo, una predicción sobre el futuro, o una valoración puramente subjetiva sin ningún hecho comprobable debajo.",
  };
}

function concreteQuestion(text: string): ClefQuestion {
  return {
    type: "noul",
    instructions:
      `Fragmento «${text}». ¿Nombra sujeto, acción y objeto de forma lo bastante concreta como para buscarlo en una fuente? ` +
      "Responde alto si dice quién hizo qué, o qué cantidad corresponde a qué cosa. " +
      "Responde bajo si le falta el sujeto, le falta el dato, o es una frase general que podría aplicarse a casi cualquier contexto.",
  };
}

function agreedQuestion(text: string): ClefQuestion {
  return {
    type: "noul",
    instructions:
      `Fragmento «${text}». Si dos periodistas con los mismos datos delante tuvieran que decidir si esto es verdadero o falso, ¿llegarían a la misma conclusión? ` +
      "Responde alto cuando la frase afirma algo definido: una cantidad, una fecha, un acto concreto, algo que ocurrió o no ocurrió. " +
      "Responde bajo cuando la respuesta dependería de la interpretación de cada uno, por tratarse de una valoración, una metáfora o una relación de causa discutible.",
  };
}

/**
 * Candidates that can never be a claim are dropped before spending a Clef
 * call. Clef rates "Hablemos de los accidentes" (a proposal) as more factual
 * than "el sistema ferroviario es seguro", so speech acts are filtered here
 * deterministically instead of by lowering the factual floor.
 */
export function gateCandidates(candidates: ClaimCandidate[]): ClaimCandidate[] {
  return candidates.filter((candidate) => {
    if (tokenize(candidate.text).length < 4) return false;
    return !isSpeechAct(candidate.text);
  });
}

export function buildGateQuestions(candidates: ClaimCandidate[]): Record<string, ClefQuestion> {
  const questions: Record<string, ClefQuestion> = {};
  for (const candidate of candidates) {
    questions[`${candidate.id}__closed`] = closedQuestion(candidate.text);
    questions[`${candidate.id}__factual`] = factualQuestion(candidate.text);
    // Clef answers every question in one round trip, so these two cost about
    // 150 ms over the whole call, not 150 ms per span.
    questions[`${candidate.id}__concrete`] = concreteQuestion(candidate.text);
    questions[`${candidate.id}__agreed`] = agreedQuestion(candidate.text);
  }
  return questions;
}

export function buildGateState(candidates: ClaimCandidate[]): string {
  return JSON.stringify({
    context: GATE_CONTEXT,
    instruction:
      "Para cada fragmento responde las dos preguntas indicadas. No reescribas el texto ni uses conocimiento externo.",
    fragments: candidates.map((candidate) => ({ id: candidate.id, text: candidate.text })),
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function probability(answers: Record<string, unknown>, key: string): number {
  return clamp01(Number(record(answers[key]).noul ?? 0));
}

export function scoreGate(
  candidates: ClaimCandidate[],
  answers: unknown,
): GateScore[] {
  const map = record(answers);
  return candidates.map((candidate) => {
    const closed = probability(map, `${candidate.id}__closed`);
    const factual = probability(map, `${candidate.id}__factual`);
    const concrete = probability(map, `${candidate.id}__concrete`);
    const agreed = probability(map, `${candidate.id}__agreed`);
    return {
      candidate,
      closed,
      factual,
      concrete,
      agreed,
      precision: concrete * agreed,
      score: closed * factual,
    };
  });
}

export function passesGate(entry: GateScore): boolean {
  return (
    entry.closed >= GATE_MIN_CLOSED &&
    entry.factual >= GATE_MIN_FACTUAL &&
    entry.score >= GATE_MIN_SCORE
  );
}

/**
 * Picks the span to publish. The old code added at most 0.06 for extra parts,
 * which could never outweigh a 0.33 probability gap, so it systematically
 * preferred short truncated spans. Length now wins outright whenever the two
 * scores are within the tie margin.
 */
export function selectGated(scores: GateScore[]): GateScore | null {
  const passing = scores.filter(passesGate);
  if (passing.length === 0) return null;
  const best = passing.reduce((left, right) => (right.score > left.score ? right : left));
  const contenders = passing.filter((entry) => best.score - entry.score <= GATE_TIE_MARGIN);
  return contenders.reduce((left, right) => {
    if (right.candidate.partCount !== left.candidate.partCount) {
      return right.candidate.partCount > left.candidate.partCount ? right : left;
    }
    return right.score > left.score ? right : left;
  });
}

export type GateResult = {
  selected: GateScore | null;
  scores: GateScore[];
  skipped: boolean;
};

/** Runs the gate against Clef. Returns `skipped` when no call was worth it. */
export async function runGate(candidates: ClaimCandidate[]): Promise<GateResult> {
  const eligible = gateCandidates(candidates);
  if (eligible.length === 0) return { selected: null, scores: [], skipped: true };

  try {
    const raw = await clefQueue.enqueue({
      key: `gate:${fnv1a(eligible.map((candidate) => candidate.text).join("|"))}`,
      priority: 0,
      run: () => callClefRaw(buildGateState(eligible), buildGateQuestions(eligible)),
    });
    const scores = scoreGate(eligible, raw.answers);
    return { selected: selectGated(scores), scores, skipped: false };
  } catch {
    return { selected: null, scores: [], skipped: false };
  }
}
