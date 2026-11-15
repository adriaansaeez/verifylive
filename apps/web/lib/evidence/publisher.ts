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

/**
 * Outlets seen often enough to be worth knowing offline. Classifying a domain
 * costs about 1.4 s, so without this seed the first claim of a session paid
 * four seconds to look up newspapers it meets in every capture. Everything
 * here was verified by hand against the harness.
 */
const KNOWN_PRESS: Record<string, PublisherTier> = {
  // Agencias y verificadores.
  "efe.com": "reliable_secondary",
  "verifica.efe.com": "reliable_secondary",
  "europapress.es": "reliable_secondary",
  "newtral.es": "reliable_secondary",
  "maldita.es": "reliable_secondary",
  "verificat.cat": "reliable_secondary",
  // Diarios nacionales.
  "elpais.com": "reliable_secondary",
  "elmundo.es": "reliable_secondary",
  "abc.es": "reliable_secondary",
  "larazon.es": "reliable_secondary",
  "lavanguardia.com": "reliable_secondary",
  "eldiario.es": "reliable_secondary",
  "elconfidencial.com": "reliable_secondary",
  "elconfidencialdigital.com": "reliable_secondary",
  "elespanol.com": "reliable_secondary",
  "publico.es": "reliable_secondary",
  "infolibre.es": "reliable_secondary",
  "vozpopuli.com": "reliable_secondary",
  "theobjective.com": "reliable_secondary",
  "elplural.com": "reliable_secondary",
  "eldebate.com": "reliable_secondary",
  "lamarea.com": "reliable_secondary",
  "huffingtonpost.es": "reliable_secondary",
  "20minutos.es": "reliable_secondary",
  "elperiodico.com": "reliable_secondary",
  "que.es": "reliable_secondary",
  "democrata.es": "reliable_secondary",
  "esdiario.com": "reliable_secondary",
  "gaceta.es": "reliable_secondary",
  // Radio y televisión.
  "rtve.es": "reliable_secondary",
  "lasexta.com": "reliable_secondary",
  "antena3.com": "reliable_secondary",
  "cadenaser.com": "reliable_secondary",
  "cope.es": "reliable_secondary",
  "telecinco.es": "reliable_secondary",
  "cuatro.com": "reliable_secondary",
  "euronews.com": "reliable_secondary",
  "es.euronews.com": "reliable_secondary",
  "france24.com": "reliable_secondary",
  // Economía.
  "expansion.com": "reliable_secondary",
  "eleconomista.es": "reliable_secondary",
  "cincodias.elpais.com": "reliable_secondary",
  "businessinsider.es": "reliable_secondary",
  // Prensa regional.
  "lavozdegalicia.es": "reliable_secondary",
  "elcorreo.com": "reliable_secondary",
  "elcorreogallego.es": "reliable_secondary",
  "heraldo.es": "reliable_secondary",
  "lne.es": "reliable_secondary",
  "laprovincia.es": "reliable_secondary",
  "lasprovincias.es": "reliable_secondary",
  "laopiniondemurcia.es": "reliable_secondary",
  "laverdad.es": "reliable_secondary",
  "diariosur.es": "reliable_secondary",
  "diariodevalladolid.es": "reliable_secondary",
  "noticiasdenavarra.com": "reliable_secondary",
  "lavozdelsur.es": "reliable_secondary",
  "melillahoy.es": "reliable_secondary",
  "objetivocastillalamancha.es": "reliable_secondary",
  "clm24.es": "reliable_secondary",
  "salamancadiario.com": "reliable_secondary",
  // Prensa en español de fuera de España.
  "infobae.com": "reliable_secondary",
  "clarin.com": "reliable_secondary",
  "prensalibre.com": "reliable_secondary",
  "elobservador.com.uy": "reliable_secondary",
  "ambito.com": "reliable_secondary",
  // Fuentes primarias que aparecen a menudo.
  "ine.es": "primary",
  "transportes.gob.es": "primary",
  "lamoncloa.gob.es": "primary",
  "boe.es": "primary",
  "adif.es": "primary",
  "bde.es": "primary",
  "congreso.es": "primary",
  "senado.es": "primary",
};

export function knownTier(host: string): PublisherTier | null {
  return KNOWN_PRESS[host.toLowerCase().replace(/^www\./u, "")] ?? null;
}

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
/** Unknown domains asked at once. Three is what a single claim can cite. */
const CLASSIFY_CONCURRENCY = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

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
    const known = knownTier(host);
    if (known) {
      resolved.set(host, known);
      continue;
    }
    let cached: PublisherTier | null = null;
    try {
      cached = store.get(host);
    } catch {
      // A broken store is not a verdict about this host.
      cached = null;
    }
    if (cached) {
      resolved.set(host, cached);
      continue;
    }
    pending.push(host);
  }

  // Strictly sequential cost 1.4 s per domain and made this the slowest stage
  // of the whole pipeline, ahead of the search itself. A small window keeps
  // the rate limit at bay (retries still cover a 429) while a claim citing
  // three unknown outlets waits once instead of three times.
  for (const batch of chunk(pending, CLASSIFY_CONCURRENCY)) {
    const answers = await Promise.all(
      batch.map(async (host) => [host, await askModel(host)] as const),
    );
    for (const [host, tier] of answers) {
    // An unanswered host stays "other" for this claim, but is NOT cached: a
    // transient failure must not permanently demote a real newspaper.
      if (tier) {
        try {
          store.set(host, tier);
        } catch {
          // Losing the cache write only costs one call next time.
        }
      }
      resolved.set(host, tier ?? "other");
    }
  }

  return resolved;
}
