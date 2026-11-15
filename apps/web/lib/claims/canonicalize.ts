import { CANONICALIZE_TIMEOUT_MS, CHAT_URL } from "@/lib/config";
import { buildQueries } from "@/lib/claims/heuristic";
import { clip, normalizeText, rewriteNumberWords } from "@/lib/text";
import type { Session } from "@/lib/types";

export type CanonicalClaim = {
  statement: string;
  queries: string[];
};

const SYSTEM_PROMPT = `Eres el normalizador de afirmaciones de un fact-checker en directo.
Recibes una cita literal de una transcripción automática en español, que puede contener muletillas, repeticiones del reconocedor de voz, opiniones o varias afirmaciones.
Devuelve SOLO JSON válido: {"claims":[{"statement":"...","queries":["..."]}]}.

Reglas:
- Convierte cada hecho verificable en una afirmación atómica, breve y declarativa.
- Conserva sujeto, lugar, tiempo, cantidad, modalidad y negaciones importantes.
- CONSERVA el sujeto gramatical tal como se dijo. Si el hablante habla en primera persona, deja la primera persona («He inaugurado el AVE Madrid-Ourense»). NUNCA escribas «el hablante», «el orador» ni inventes un nombre: no sabes quién habla.
- Elimina muletillas, encuadres y opiniones como «creo», «es justo decir», «evidentemente» o «esto no es serio», pero conserva el hecho que había debajo.
- Escribe las cantidades en cifras: «diecinueve mil millones» pasa a «19.000 millones».
- No añadas datos que no estén implicados por la cita. No corrijas el hecho ni decidas si es verdadero.
- No conviertas preguntas, deseos, recomendaciones o frases incompletas en hechos.
- Si la cita contiene varios hechos independientes, sepáralos. Máximo 3.
- Cada query debe ser una búsqueda web de 3 a 7 palabras, sin muletillas, conservando las entidades y las cifras clave. Nada de frases largas: los buscadores devuelven menos resultados cuanto más larga es la consulta.
- Si no hay una afirmación verificable completa, devuelve {"claims":[]}.

Ejemplo:
Cita: «Pero creo que también es justo decir que el sistema ferroviario en nuestro país, pese a las dificultades, es un sistema seguro»
Salida: {"claims":[{"statement":"El sistema ferroviario español es seguro.","queries":["seguridad sistema ferroviario España","accidentes ferroviarios España seguridad"]}]}`;

function contentOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "").join("");
}

export function parseCanonicalClaims(content: string): CanonicalClaim[] {
  const clean = content.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return [];
  }
  const rows = payload && typeof payload === "object" ? (payload as { claims?: unknown }).claims : null;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const output: CanonicalClaim[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const statement = clip(String((row as { statement?: unknown }).statement ?? "").trim(), 200);
    if (statement.length < 10 || /\?\s*$/u.test(statement)) continue;
    // A statement whose subject became "el hablante" can never be checked
    // against a source, so it is rejected rather than published as a claim.
    if (/\b(?:el|la)\s+(?:hablante|orador|oradora|entrevistad[oa]|locutor[a]?)\b/iu.test(statement)) continue;
    const key = normalizeText(statement);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rawQueries = (row as { queries?: unknown }).queries;
    const queries = Array.isArray(rawQueries)
      ? rawQueries.filter((query): query is string => typeof query === "string")
          .map((query) => clip(query.trim(), 120)).filter(Boolean).slice(0, 3)
      : [];
    output.push({ statement, queries: queries.length > 0 ? queries : buildQueries(statement) });
  }
  return output.slice(0, 3);
}

export type CanonicalizeContext = {
  spokenAtMs?: number;
  session?: Pick<Session, "createdAt" | "sourceType">;
};

/**
 * Relative time ("estos últimos ocho años") is unresolvable without knowing
 * when it was said, and a claim whose subject was replaced by "el hablante" is
 * unverifiable by construction. Both are given to the model as context.
 */
function contextLines(context: CanonicalizeContext | undefined): string {
  const lines: string[] = [];
  const createdAt = context?.session?.createdAt;
  if (createdAt) {
    const date = new Date(createdAt);
    if (!Number.isNaN(date.getTime())) {
      lines.push(`Fecha de la captura: ${date.toISOString().slice(0, 10)}.`);
    }
  }
  if (typeof context?.spokenAtMs === "number") {
    lines.push(`Minuto de la grabación: ${Math.floor(context.spokenAtMs / 60000)}.`);
  }
  return lines.length > 0 ? `${lines.join(" ")}\n` : "";
}

export async function canonicalizeClaim(
  quote: string,
  context?: CanonicalizeContext,
): Promise<CanonicalClaim[]> {
  const key = process.env.NAN_KEY?.trim();
  const model = process.env.NAN_CHAT_MODEL?.trim();
  if (!key || !model) return [];

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${contextLines(context)}Cita literal:\n<<<\n${clip(rewriteNumberWords(quote), 900)}\n>>>`,
    },
  ];

  const post = async (noThink: boolean): Promise<Response> =>
    fetch(CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
        // Normalising a quote needs no chain of thought. With thinking on,
        // qwen3.8-flash took 16 s and hit the timeout, so every messy span
        // fell back to searching the whole spoken sentence; with it off the
        // same call answers in under a second with the same output.
        ...(noThink
          ? { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
      signal: AbortSignal.timeout(CANONICALIZE_TIMEOUT_MS),
      cache: "no-store",
    });

  try {
    let response = await post(true);
    // A model that rejects the thinking switch still deserves an answer.
    if (response.status === 400) response = await post(false);
    if (!response.ok) return [];
    return parseCanonicalClaims(contentOf(await response.json()));
  } catch {
    return [];
  }
}
