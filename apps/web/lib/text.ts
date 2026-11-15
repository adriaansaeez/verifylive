const STOPWORDS = new Set(
  `a al algo algunas algunos ante antes aquel aquella aquellas aquellos aqui asi aun
  con contra cual cuales cuando de del desde donde dos durante e el ella ellas ellos en
  entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto
  estos fue fueron ha habia han hasta hay la las le les lo los mas me mi mis mucho muy
  nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que quien
  se sea segun ser si sin sobre son su sus tambien tan tanto te tiene tienen todo todos
  tu tus un una uno unos y ya yo
  about after all also am an and any are as at be been being but by can could did do
  does for from had has have he her here him his how i if in into is it its just like
  may me more most my no not of on one only or other our out over own same she should
  so some such than that the their them then there these they this those to too under
  up very was we were what when where which while who will with would you your`
    .split(/\s+/)
    .filter(Boolean),
);

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[“”„"'`´«»]/g, " ")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function tokenCoverage(query: string[], document: string[]): number {
  if (query.length === 0) return 0;
  const doc = new Set(document);
  let hits = 0;
  for (const token of new Set(query)) if (doc.has(token)) hits += 1;
  return hits / new Set(query).size;
}

export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function dedupeKey(text: string): string {
  return fnv1a(normalizeText(text));
}

const ABBREVIATIONS = new Set(["sr", "sra", "dr", "dra", "etc", "ee", "uu", "aprox", "no"]);

/** Sentence splitter that keeps the punctuation and tolerates Spanish decimals. */
export function splitSentences(value: string): string[] {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "." && char !== "!" && char !== "?" && char !== ";") continue;
    const next = text[index + 1];
    if (next && next !== " " && next !== ")" && next !== "”" && next !== '"') continue;
    const before = text.slice(start, index);
    const lastWord = normalizeText(before).split(" ").at(-1) ?? "";
    if (char === "." && ABBREVIATIONS.has(lastWord)) continue;
    if (char === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(next ?? "")) continue;
    const sentence = text.slice(start, index + 1).trim();
    if (sentence) sentences.push(sentence);
    start = index + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

export function clip(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Picks the paragraph/sentence window that best matches the claim tokens. */
export function extractSnippet(text: string, queryTokens: string[], maxChars: number): string {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!clean) return "";
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) units.push(sentence);
  }

  const scored = units.map((unit, index) => ({
    unit,
    index,
    score: tokenCoverage(queryTokens, tokenize(unit)) + (index === 0 ? 0.05 : 0),
  }));
  scored.sort((left, right) => right.score - left.score);

  const chunks: string[] = [];
  let length = 0;
  for (const { unit } of scored) {
    if (chunks.length >= 2) break;
    if (unit.length < 40) continue;
    if (length + unit.length > maxChars) continue;
    chunks.push(unit);
    length += unit.length + 1;
    if (length > maxChars * 0.7) break;
  }
  if (chunks.length === 0) return clip(clean, maxChars);
  return clip(chunks.sort((left, right) => clean.indexOf(left) - clean.indexOf(right)).join("\n\n"), maxChars);
}

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/gi,
  /disregard (all |any )?(previous|prior|above) (instructions|prompts?)/gi,
  /olvida (todas )?(las )?(instrucciones|indicaciones) (anteriores|previas)/gi,
  /ignora (todas )?(las )?(instrucciones|indicaciones) (anteriores|previas)/gi,
  /^\s*(system|assistant|developer)\s*:/gim,
  /<\|?(system|im_start|im_end|endoftext)\|?>/gi,
];

/**
 * Remote pages are data, never instructions. This is a cheap deterministic
 * filter; the real boundary is that no retrieved text is ever executed and the
 * prompt delimits it explicitly.
 */
export function sanitizeUntrusted(value: string): string {
  let text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  for (const pattern of INJECTION_PATTERNS) text = text.replace(pattern, "[texto eliminado]");
  return text.replace(/<<<|>>>/g, "‹‹‹").replace(/[ \t]+/g, " ").trim();
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Weighted lexical score used by the deterministic ranker. */
export function lexicalScore(queryTokens: string[], document: string): number {
  const docTokens = tokenize(document);
  if (docTokens.length === 0) return 0;
  const coverage = tokenCoverage(queryTokens, docTokens);
  if (coverage === 0) return 0;
  const density = new Set(queryTokens).size / Math.max(6, docTokens.length);
  return coverage * 0.8 + Math.min(0.2, density);
}

/**
 * Accented spellings are listed explicitly: the regex is built from these
 * keys, so without them "dos mil veintiséis" matched only "dos mil" and came
 * out as "2000 veintiséis". Lookups normalise accents away, so the accented
 * and bare forms resolve to the same value.
 */
const NUMBER_WORDS: Record<string, number> = {
  cero: 0, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, "dieciséis": 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, "veintiún": 21, "veintiuna": 21,
  veintidos: 22, "veintidós": 22, veintitres: 23, "veintitrés": 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, "veintiséis": 26, veintisiete: 27,
  veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
  mil: 1_000, millon: 1_000_000, "millón": 1_000_000, millones: 1_000_000,
};

/**
 * "diecinueve mil millones" is 19 thousand millions, not 19000 + 1000000.
 * Scale words multiply what has been accumulated so far instead of being
 * added to it, which is what makes chained scales come out right.
 */
const SCALE_WORDS = new Set(["mil", "millon", "millones"]);

function numberWordsValue(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of words) {
    const value = NUMBER_WORDS[word];
    if (value === undefined) return null;
    if (value === 1_000) {
      current = (current || 1) * 1_000;
      total += current;
      current = 0;
    } else if (value === 1_000_000) {
      total = (total + current || 1) * 1_000_000;
      current = 0;
    } else {
      current += value;
    }
    seen = true;
  }
  return seen ? total + current : null;
}

/**
 * Speech says "cuatrocientos mil", search engines index "400000". Rewriting
 * spelled-out quantities into digits is what makes web search useful at all.
 */
/**
 * Spanish ASR writes a spoken thousands group as a stray "cero": the captured
 * interview says "diecinueve cero millones" for "19.000 millones". Read
 * literally that is 19 million, off by three orders of magnitude, so the
 * group marker is restored before any number is parsed.
 */
export function repairSpokenThousands(value: string): string {
  return value.replace(
    /\b((?:un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento)(?:\s+y\s+\w+)?)\s+cero\s+(mill[oó]n|millones)\b/giu,
    "$1 mil $2",
  );
}

export function rewriteNumberWords(value: string): string {
  const keys = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
  const run = `(?:${keys.join("|")})(?:\\s+(?:y\\s+)?(?:${keys.join("|")}))*`;
  const percent = new RegExp(`\\b(${run})\\s+por\\s+ciento\\b`, "giu");
  const anyRun = new RegExp(`\\b${run}\\b`, "giu");
  const toNumber = (text: string) =>
    numberWordsValue(normalizeText(text).split(/\s+/u).filter((word) => word !== "y"));

  return repairSpokenThousands(value)
    .replace(percent, (match, group: string) => {
      const number = toNumber(group);
      return number === null ? match : `${number}%`;
    })
    .replace(anyRun, (match) => {
      const words = normalizeText(match).split(/\s+/u).filter((word) => word !== "y");
      const number = numberWordsValue(words);
      if (number === null) return match;
      if (number < 100 && words.length < 2) return match;
      // A bare scale word carries no quantity: "un millón" must not become
      // "un 1 millones".
      if (words.length === 1 && SCALE_WORDS.has(words[0] ?? "")) return match;
      // Spanish reports large budgets as "19000 millones", never as
      // "19000000000": keep the unit so the figure stays searchable.
      const last = words.at(-1);
      if ((last === "millones" || last === "millon") && number >= 1_000_000 && number % 1_000_000 === 0) {
        return `${number / 1_000_000} millones`;
      }
      return String(number);
    })
    .replace(/(\d+)\s+por\s+ciento\b/giu, "$1%");
}
