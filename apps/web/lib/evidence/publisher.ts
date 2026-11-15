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

/**
 * The wording matters more than it looks. A first version ended with "ante la
 * duda, responde other" and the model then refused to recognise La Razón, El
 * Español or Infobae: 6 of 20 newspapers placed. Naming the regional and
 * Latin American press explicitly, and dropping the tie-breaker, takes it to
 * 20 of 20 on the outlets real captures actually cited.
 */
const SYSTEM_PROMPT = `Clasificas el tipo de sitio web al que pertenece un dominio, para un verificador de hechos en español.
Responde SOLO con JSON válido: {"tier":"primary"|"reliable_secondary"|"other"}.

- "primary": la fuente original del dato. Organismos públicos (ministerios, INE, Banco de España, parlamentos, Eurostat, ONU, OMS), universidades, revistas científicas y boletines oficiales.
- "reliable_secondary": CUALQUIER medio de comunicación con redacción: diarios nacionales, diarios regionales y locales, radios, televisiones, revistas, agencias de noticias y verificadores. Da igual su tamaño, su ideología o si es español o latinoamericano.
- "other": lo que no es ni fuente oficial ni medio de comunicación: diccionarios, plataformas de vídeo, redes sociales, foros, blogs personales, portales de empleo, webs de empresa, inmobiliarias y tiendas.`;

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

const RATE_LIMIT_BACKOFF_MS = 1_200;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askOnce(host: string, key: string, model: string): Promise<Response | null> {
  try {
    return await fetch(CHAT_URL, {
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
  } catch {
    return null;
  }
}

/**
 * Retries the throttled and transient failures. Treating a 429 as "this is
 * not a newspaper" is what made the first measurement of this classifier read
 * 39% correct when the prompt was in fact answering fine.
 */
async function askModel(host: string): Promise<PublisherTier | null> {
  const key = process.env.NAN_KEY?.trim();
  const model = process.env.NAN_CHAT_MODEL?.trim();
  if (!key || !model) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await askOnce(host, key, model);
    if (!response) return null;
    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_ATTEMPTS - 1) await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
      continue;
    }
    if (!response.ok) return null;
    try {
      return parsePublisherTier(contentOf(await response.json()));
    } catch {
      return null;
    }
  }
  return null;
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

  // Sequential on purpose: firing these in parallel trips the provider's rate
  // limit, and a throttled host would be remembered as "other" for good.
  for (const host of pending) {
    const tier = await askModel(host);
    // An unanswered host stays "other" for this claim, but is NOT cached: a
    // transient failure must not permanently demote a real newspaper.
    if (tier) store.set(host, tier);
    resolved.set(host, tier ?? "other");
  }

  return resolved;
}
