import { CHAT_URL, CONNECTOR_TIMEOUT_MS } from "@/lib/config";
import type { Checkability, ExtractedClaim } from "@/lib/types";
import { clamp01, clip, dedupeKey, normalizeText, splitSentences } from "@/lib/text";
import { extractHeuristicClaims } from "./heuristic";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type RawClaim = {
  text?: unknown;
  startChar?: unknown;
  endChar?: unknown;
  checkability?: unknown;
  queries?: unknown;
};

const CHECKABILITIES = new Set<Checkability>(["likely_fact", "likely_opinion", "unclear"]);

const SYSTEM_PROMPT = `Eres un extractor de afirmaciones verificables de una transcripción en vivo.
Devuelve SOLO JSON válido con la forma {"claims":[{"text":"...","startChar":0,"endChar":0,"checkability":"likely_fact","queries":["..."]}]}.

Reglas:
- Extrae únicamente afirmaciones factuales concretas que puedan contrastarse con fuentes.
- No extraigas opiniones, valoraciones ("el mejor", "una vergüenza"), predicciones, preguntas, promesas, chistes ni llamadas al voto.
- "text" debe ser una subcadena EXACTA de la transcripción.
- "startChar" y "endChar" son índices de carácter en la transcripción (endChar exclusivo).
- "checkability" es "likely_fact", "likely_opinion" o "unclear".
- "queries" contiene 1-3 búsquedas cortas en el idioma original.
- Máximo 6 afirmaciones. Si no hay ninguna, devuelve {"claims":[]}.`;

function chatContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("");
  }
  return "";
}

type RawClaimsPayload = { claims?: unknown };

function parseJsonObject(content: string): RawClaimsPayload | null {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as RawClaimsPayload;
  } catch {
    return null;
  }
}

function spanFromChars(
  text: string,
  startChar: number,
  endChar: number,
  startMs: number,
  endMs: number,
): { startMs: number; endMs: number } {
  const total = Math.max(1, text.length);
  const duration = Math.max(0, endMs - startMs);
  const start = clamp01(startChar / total);
  const end = clamp01(endChar / total);
  return {
    startMs: Math.round(startMs + duration * start),
    endMs: Math.round(startMs + duration * Math.max(start, end)),
  };
}

function normalizeRawClaims(
  raw: RawClaimsPayload | null,
  input: { text: string; startMs: number; endMs: number },
): ExtractedClaim[] {
  if (!raw) return [];
  const list = raw.claims;
  if (!Array.isArray(list)) return [];

  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  for (const item of list as RawClaim[]) {
    if (!item || typeof item.text !== "string") continue;
    const text = item.text.trim();
    if (text.length < 8 || text.length > 260) continue;
    const index = input.text.indexOf(text);
    if (index < 0) continue;

    const startChar = Number.isFinite(Number(item.startChar)) ? Number(item.startChar) : index;
    const endChar = Number.isFinite(Number(item.endChar)) ? Number(item.endChar) : index + text.length;
    const safeStart = Math.min(Math.max(0, startChar), input.text.length);
    const safeEnd = Math.min(Math.max(safeStart, endChar), input.text.length);
    if (input.text.slice(safeStart, safeEnd).trim() !== text) continue;

    const normalized = normalizeText(text);
    const key = dedupeKey(text);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);

    const checkabilityRaw = String(item.checkability ?? "");
    const checkability = CHECKABILITIES.has(checkabilityRaw as Checkability)
      ? (checkabilityRaw as Checkability)
      : "likely_fact";
    if (checkability === "likely_opinion") continue;

    const queries = Array.isArray(item.queries)
      ? item.queries
          .filter((query): query is string => typeof query === "string")
          .map((query) => clip(query, 160))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    claims.push({
      text: clip(text, 240),
      normalizedText: normalized,
      quote: clip(text, 240),
      ...spanFromChars(input.text, safeStart, safeEnd, input.startMs, input.endMs),
      checkability,
      searchQueries: queries.length > 0 ? queries : [clip(text, 160)],
    });
  }

  claims.sort((left, right) => left.startMs - right.startMs);
  return claims.slice(0, 6);
}

/** One bounded chat call. Any failure falls back to the deterministic extractor. */
export async function extractWithChat(input: {
  text: string;
  startMs: number;
  endMs: number;
}): Promise<ExtractedClaim[]> {
  const key = process.env.NAN_KEY?.trim();
  const model = process.env.NAN_CHAT_MODEL?.trim();
  if (!key || !model) return extractHeuristicClaims(input);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Transcripción (${input.text.length} caracteres):\n<<<\n${input.text}\n>>>`,
    },
  ];

  try {
    const response = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(Math.min(CONNECTOR_TIMEOUT_MS * 2, 20_000)),
      cache: "no-store",
    });
    if (!response.ok) return extractHeuristicClaims(input);
    const content = chatContent(await response.json());
    const parsed = parseJsonObject(content);
    const claims = normalizeRawClaims(parsed, input);
    return claims.length > 0 ? claims : extractHeuristicClaims(input);
  } catch {
    return extractHeuristicClaims(input);
  }
}

export function sentencesOf(text: string): string[] {
  return splitSentences(text);
}
