/**
 * Lectura de una URL de YouTube pegada por el usuario.
 *
 * El reproductor va incrustado en esta misma pestaña a propósito: el audio de
 * un iframe de otro origen no se puede leer desde la página, así que la única
 * vía honesta es que el vídeo suene aquí y que la captura de pestaña que ya
 * usa la app lo recoja. Por eso basta con el identificador y el segundo de
 * inicio; no se descarga nada ni se toca el audio por nuestra cuenta.
 */

export type YoutubeRef = { id: string; startSeconds: number };

const ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_PREFIXES = ["embed", "live", "shorts", "v"];

/** `90`, `90s`, `1m30s`, `1h2m3s` → segundos. */
function seconds(raw: string | null): number {
  if (!raw) return 0;
  const plain = raw.trim();
  if (/^\d+$/.test(plain)) return Number.parseInt(plain, 10);
  const parts = plain.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!parts) return 0;
  const [, h, m, s] = parts;
  const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/** Devuelve null si el texto no identifica un vídeo; nunca lanza. */
export function parseYoutube(input: string): YoutubeRef | null {
  const text = input.trim();
  if (!text) return null;

  // Un identificador pegado a secas.
  if (ID.test(text)) return { id: text, startSeconds: 0 };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return ID.test(id) ? { id, startSeconds: start } : null;
  }

  if (host !== "youtube.com" && host !== "youtube-nocookie.com" && host !== "m.youtube.com") {
    return null;
  }

  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return { id: v, startSeconds: start };

  const segments = url.pathname.split("/").filter(Boolean);
  const [head, next] = segments;
  if (head && next && PATH_PREFIXES.includes(head.toLowerCase()) && ID.test(next)) {
    return { id: next, startSeconds: start };
  }

  return null;
}

/**
 * URL de incrustación. Dominio sin cookies y `enablejsapi` para poder mandarle
 * órdenes por postMessage sin cargar ningún script de terceros, que la página
 * está aislada entre orígenes y no podría traerlo.
 */
export function embedUrl(ref: YoutubeRef, origin: string): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  if (ref.startSeconds > 0) params.set("start", String(ref.startSeconds));
  if (origin) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${ref.id}?${params.toString()}`;
}

export function watchUrl(ref: YoutubeRef): string {
  return `https://www.youtube.com/watch?v=${ref.id}`;
}
