import { CANONICALIZE_TIMEOUT_MS, CHAT_URL } from "@/lib/config";
import type { SourceTier } from "@/lib/types";

/**
 * Who published this, and can we stand behind it?
 *
 * A hand-kept list of forty domains cannot describe the Spanish press. Over a
 * day of real captures it left La Razón, Infobae, Clarín, Vozpópuli, La Nueva
 * España, Las Provincias and Noticias de Navarra in the same bucket as a job
 * board: of thirteen claims whose only sources were "other", ten were in fact
 * backed by real newspapers and were marked provisional for nothing.
 *
 * So the list stays as the fast, offline path, a deny list catches the hosts
 * that are never journalism, and anything still unknown is classified once by
 * the chat model and cached. A domain costs one call, ever.
 */

export type PublisherTier = SourceTier;

export type PublisherStore = {
  get(host: string): PublisherTier | null;
  set(host: string, tier: PublisherTier): void;
};

/** Hosts that are never evidence, whatever they publish. */
const NEVER_PRESS = [
  // Reference works and raw platforms: not a claim about the world.
  "rae.es",
  "dle.rae.es",
  "wordreference.com",
  "youtube.com",
  "dailymotion.com",
  "vimeo.com",
  "scribd.com",
  "slideshare.net",
  "academia.edu",
  "issuu.com",
  // Job boards, listings and emigration blogs.
  "jobrise.io",
  "infojobs.net",
  "indeed.com",
  "glassdoor.com",
  "linkedin.com",
  "mevoyalmundo.com",
  "suizaespanol.com",
  // Blogging and personal publishing platforms.
  "blogspot.com",
  "wordpress.com",
  "medium.com",
  "substack.com",
  "wixsite.com",
  "blogs.ua.es",
  "diarium.usal.es",
];

export function isNeverPress(host: string): boolean {
  const clean = host.toLowerCase().replace(/^www\./u, "");
  return NEVER_PRESS.some((blocked) => clean === blocked || clean.endsWith(`.${blocked}`));
}

const SYSTEM_PROMPT = `Clasificas la fiabilidad editorial del dominio de una fuente para un verificador de hechos.
Responde SOLO con JSON válido: {"tier":"primary"|"reliable_secondary"|"other"}.

- "primary": fuente original del dato. Organismos públicos y oficiales (ministerios, INE, Banco de España, parlamentos, Eurostat, ONU, OMS), universidades, revistas científicas revisadas por pares, y los boletines oficiales.
- "reliable_secondary": medio periodístico con redacción identificable y responsabilidad editorial, sea nacional, regional o extranjero, incluidas las agencias de noticias y las organizaciones de fact-checking.
- "other": todo lo demás. Blogs personales, agregadores sin redacción, webs de empresa o marketing, foros, tiendas, portales de empleo, granjas de contenido y diccionarios.

Juzga el dominio, no un artículo concreto. Ante la duda entre periodístico y no periodístico, responde "other".`;

const TIERS = new Set<PublisherTier>(["primary", "reliable_secondary", "other"]);

export function parsePublisherTier(content: string): PublisherTier | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  const tier = payload && typeof payload === "object" ? (payload as { tier?: unknown }).tier : null;
  return typeof tier === "string" && TIERS.has(tier as PublisherTier)
    ? (tier as PublisherTier)
    : null;
}

function contentOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  return typeof message === "string" ? message : "";
}

async function askModel(host: string): Promise<PublisherTier | null> {
  const key = process.env.NAN_KEY?.trim();
  const model = process.env.NAN_CHAT_MODEL?.trim();
  if (!key || !model) return null;

  try {
    const response = await fetch(CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Dominio: ${host}` },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(CANONICALIZE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parsePublisherTier(contentOf(await response.json()));
  } catch {
    return null;
  }
}

export function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

/**
 * Resolves the tier of hosts the offline rules could not place. Unknown hosts
 * are asked about once and remembered; everything else answers from the store.
 */
export async function classifyPublishers(
  hosts: string[],
  store: PublisherStore,
): Promise<Map<string, PublisherTier>> {
  const resolved = new Map<string, PublisherTier>();
  const pending: string[] = [];

  for (const host of new Set(hosts.map((value) => value.toLowerCase().replace(/^www\./u, "")))) {
    if (!host) continue;
    if (isNeverPress(host)) {
      resolved.set(host, "other");
      continue;
    }
    const cached = store.get(host);
    if (cached) {
      resolved.set(host, cached);
      continue;
    }
    pending.push(host);
  }

  const answers = await Promise.all(
    pending.map(async (host) => [host, await askModel(host)] as const),
  );
  for (const [host, tier] of answers) {
    // An unanswered host stays "other": the deny-by-default side of the rule.
    const value = tier ?? "other";
    store.set(host, value);
    resolved.set(host, value);
  }

  return resolved;
}
