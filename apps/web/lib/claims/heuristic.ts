import type { Checkability, ExtractedClaim } from "@/lib/types";
import {
  clip,
  dedupeKey,
  normalizeText,
  rewriteNumberWords,
  sanitizeUntrusted,
  splitSentences,
  tokenize,
} from "@/lib/text";

/**
 * Deterministic, dependency-free claim extractor. It intentionally favours
 * precision over recall: a missed claim is a gap, a fabricated claim is a lie.
 */

const OPINION_MARKERS = [
  "mejor",
  "peor",
  "sin duda",
  "creo que",
  "pienso que",
  "opino que",
  "en mi opinion",
  "es una verguenza",
  "es maravilloso",
  "deberia",
  "deberian",
  "i think",
  "in my opinion",
];

const PREDICTION_MARKERS = [
  "en los proximos",
  "el proximo ano",
  "va a destruir",
  "van a desaparecer",
  "will happen",
  "is going to",
  "predigo",
];

const HEDGE_MARKERS = ["quizas", "tal vez", "podria", "maybe", "perhaps"];

const FACTUAL_NUMBER =
  /\b\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?\s?(?:%|por ciento|km|kilometros|metros|millones|mil|grados|anos|euros|personas|empleos)(?!\w)/iu;

/** Spelled-out quantities: speech rarely says "27%", it says "veintisiete por ciento". */
const NUMBER_WORD =
  /\b(?:cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|millon|millones|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve)\b/iu;

const FACTUAL_DATE = /\b(?:en|desde|durante|hasta)\s+(?:1[89]\d{2}|20\d{2})\b/iu;

const QUESTION_START = /^\s*(?:que|quien|quienes|como|cuando|donde|por que|cual|cuanto|cuanta|cuantos|cuantas|verdad)\b/iu;

/**
 * Proposals, invitations and questions are speech acts, not claims. Clef rates
 * "Hablemos de los accidentes que han sucedido" (0.19 factual) above "el
 * sistema ferroviario es un sistema seguro" (0.12), so these are filtered
 * deterministically rather than by raising the gate's factual floor and losing
 * the real claim with them.
 */
const SPEECH_ACT = [
  /^(?:hablemos|veamos|vamos a ver|pensemos|fijate|fijese|fijaos|escuchame|mirame|miren|dime|digame|cuentame|permiteme|permitame|dejame|dejeme|preguntemos|analicemos|repasemos|empecemos|sigamos|pasemos)\b/iu,
  // "Vamos," as an interjection only. "Vamos a invertir 19.000 millones" is a
  // claim, so the bare verb must not swallow it.
  /^(?:vamos|vamonos|venga|anda)\s*(?:,|$)/iu,
  /^(?:por favor|gracias|muchas gracias)\b/iu,
];

/** A greeting is a sentence made of nothing but courtesy words. */
const GREETING_WORDS = new Set([
  "hola", "buenas", "buenos", "tardes", "noches", "dias", "gracias", "muchas",
  "muy", "vale", "ok", "de", "acuerdo", "perfecto", "adios", "hasta", "luego",
  "oye", "escucha", "a", "todos", "todas", "bienvenidos", "bienvenidas",
  "encantado", "igualmente", "si", "no", "claro",
]);

function hasMarker(text: string, markers: string[]): boolean {
  const normalized = normalizeText(text);
  return markers.some((marker) => normalized.includes(normalizeText(marker)));
}

/**
 * Spoken Spanish ends declarative sentences with a tag question. "Vamos a
 * invertir 19.000 millones en el mantenimiento de las vías, ¿no?" is a claim
 * with a figure in it, and treating the tag as a question dropped it.
 */
const TAG_QUESTION = /[,\s]*[¿]?\s*(?:no|verdad|eh|sabes|sabe|vale|cierto|me entiendes)\s*\?\s*$/iu;

/** True for greetings, questions and proposals: never a verifiable claim. */
export function isSpeechAct(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/\?\s*$/u.test(trimmed.replace(TAG_QUESTION, ""))) return true;
  const normalized = normalizeText(trimmed)
    .replace(/^(?:y|pero|bueno|pues|entonces)\s+/u, "");
  const words = normalized.split(" ").filter(Boolean);
  if (words.length > 0 && words.every((word) => GREETING_WORDS.has(word))) return true;
  return SPEECH_ACT.some((pattern) => pattern.test(normalized));
}

/**
 * Speech rarely produces clean facts. This classifies what we heard before
 * spending a Clef request on it, and gives the UI an honest label for the rest.
 */
export function classifyCheckability(sentence: string): Checkability {
  const text = sentence.trim();
  if (!text) return "unclear";
  if (/\?\s*$/.test(text) || QUESTION_START.test(text)) return "unclear";
  if (hasMarker(text, OPINION_MARKERS)) return "likely_opinion";
  if (hasMarker(text, PREDICTION_MARKERS)) return "unclear";
  if (hasMarker(text, HEDGE_MARKERS)) return "unclear";

  const tokens = tokenize(text);
  if (tokens.length < 3) return "unclear";

  const hasNumber = FACTUAL_NUMBER.test(text);
  const hasDate = FACTUAL_DATE.test(text);
  const hasProperNoun = /(?:^|[.!?]\s+)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/u.test(text);
  const hasFactiveVerb =
    /\b(?:fue|fueron|es|son|era|eran|gano|ganaron|ganó|creo|crearon|creó|fundo|fundaron|fundó|midio|midió|mide|tiene|tienen|tuvo|se situo|se situó|aumento|aumentó|ronda|hierve|alcanza|alcanzo|alcanzó|recibe|recibió|consume|equivale|cuesta|produjo|supera|superó|llegó|llego|causa|causan|provoca|provocan|genera|generan|produce|producen|reduce|reducen|aumenta|aumentan|disminuye|disminuyen|contiene|contienen|incluye|incluyen|ocurre|ocurren|existe|existen|hay|llueve|nieva|hace\s+(?:frío|calor)|hizo\s+(?:frío|calor)|hace\s+que|hizo\s+que)\b/iu.test(
      text,
    );

  if (text.length > 220) return "unclear";
  if (hasNumber || hasDate || NUMBER_WORD.test(text)) return "likely_fact";
  if (hasProperNoun && hasFactiveVerb) return "likely_fact";
  if (hasProperNoun) return "likely_fact";
  // Spoken assertions are often short after stop-word removal ("llueve en
  // España", "hace que suba la criminalidad"). Requiring five content words
  // was silently dropping exactly those claims.
  if (hasFactiveVerb && tokens.length >= 3) return "likely_fact";
  return "unclear";
}

/** Function words and filler that search engines ignore but that dilute a
 * keyword query ("un dato que resume la situación" → nothing useful). */
const SEARCH_STOPWORDS = new Set([
  "que", "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "y", "o", "u", "e", "en", "por", "para", "con", "sin", "al", "se", "su",
  "sus", "es", "son", "fue", "fueron", "ser", "esta", "este", "estos",
  "estas", "esto", "eso", "esa", "ese", "como", "mas", "menos", "muy", "ya",
  "no", "si", "lo", "le", "les", "me", "nos", "te", "hay", "ha", "han",
  "he", "hemos", "era", "eran", "tiene", "tienen", "tuvo", "hace", "hizo",
  "pero", "porque", "cuando", "donde", "sobre", "entre", "desde", "hasta",
  "tambien", "solo", "aqui", "alli", "puede", "pueden", "debe", "deben",
  "va", "van", "está", "están", "tenemos", "quiero", "decir", "dato", "dice",
  "resume", "resumen", "situacion", "situación", "cosa", "algo", "todo",
  "todos", "toda", "todas", "parte", "gente", "año", "anos", "años", "vez",
  "veces", "caso", "manera", "forma", "momento", "hoy", "ayer", "ahora",
  "entonces", "bueno", "pues", "mira", "escucha", "ademas", "además", "asi",
  "así", "verdad", "claramente", "basicamente", "básicamente", "importantisimo",
]);

/** Tight keyword query for web-search providers (Bing/Brave/Google). */
export function keywordQuery(sentence: string): string {
  const searchable = rewriteNumberWords(sentence);
  const words = tokenize(searchable).filter(
    (word) => word.length >= 3 && !SEARCH_STOPWORDS.has(word),
  );
  return words.slice(0, 8).join(" ");
}

/** Filler before the actual fact: "Quiero empezar con un dato que resume la
 * situación: Madrid es la capital...". Stripping it keeps the verifiable part
 * and avoids spending a Clef call on a sentence that is not a claim. */
const META_PREFIXES: RegExp[] = [
  /^(?:quiero|quisi[ée]ra|me gustar[íi]a|voy a|perm[íi]tanme|d[ée]jenme|d[ée]jame)\b[^:]{0,90}:\s*/iu,
  /^(?:como (?:todos )?sab(?:en|éis|es)|como ya saben|obviamente|evidentemente|por supuesto)[,:]\s*/iu,
  /^[^:]{0,60}\b(?:un dato|una cosa|lo que)\b[^:]{0,80}:\s*/iu,
];

export function stripMetaPrefix(sentence: string): string {
  let output = sentence.trim();
  for (let pass = 0; pass < META_PREFIXES.length; pass += 1) {
    const before = output;
    for (const pattern of META_PREFIXES) output = output.replace(pattern, "").trim();
    if (output === before) break;
  }
  return output;
}

export function buildQueries(sentence: string): string[] {
  const cleaned = sentence
    .replace(/^\s*(?:y|pero|ademas|entonces|bueno|pues|mira|escucha)\b[, ]*/iu, "")
    .replace(/^[^a-záéíóúñ0-9]+/iu, "")
    .trim();
  const searchable = rewriteNumberWords(cleaned);
  const keywords = keywordQuery(cleaned);
  const queries = new Set<string>();
  const base = clip(searchable.replace(/[.!?;]+$/u, ""), 160);
  if (base) queries.add(base);
  if (keywords && keywords !== normalizeText(base)) queries.add(keywords);
  const withoutTrailingClause = base.split(/,\s*/u)[0]?.trim() ?? "";
  if (withoutTrailingClause.length > 12 && withoutTrailingClause !== base) {
    queries.add(withoutTrailingClause);
  }
  return [...queries].slice(0, 3);
}

type Span = { startMs: number; endMs: number };

function spanForSentence(segmentText: string, sentence: string, startMs: number, endMs: number): Span {
  const total = Math.max(1, segmentText.length);
  const index = segmentText.indexOf(sentence);
  if (index < 0) return { startMs, endMs };
  const duration = Math.max(0, endMs - startMs);
  const startRatio = index / total;
  const endRatio = (index + sentence.length) / total;
  return {
    startMs: Math.round(startMs + duration * startRatio),
    endMs: Math.round(startMs + duration * endRatio),
  };
}

export function extractHeuristicClaims(input: {
  text: string;
  startMs: number;
  endMs: number;
}): ExtractedClaim[] {
  const text = sanitizeUntrusted(input.text);
  if (!text) return [];

  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(text)) {
    const trimmed = stripMetaPrefix(sentence).trim();
    if (!trimmed) continue;
    const checkability = classifyCheckability(trimmed);
    // Opinions are kept and labelled: the product promises to say "this is an
    // opinion, not a fact", never to silently drop what was said.
    if (checkability === "unclear") continue;
    const normalized = normalizeText(trimmed);
    const key = dedupeKey(trimmed);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    const span = spanForSentence(text, trimmed, input.startMs, input.endMs);
    claims.push({
      text: clip(trimmed, 240),
      normalizedText: normalized,
      quote: clip(trimmed, 240),
      startMs: span.startMs,
      endMs: span.endMs,
      checkability,
      searchQueries: buildQueries(trimmed),
    });
  }

  return claims;
}
