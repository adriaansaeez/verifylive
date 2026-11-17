import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ALLOW_PRIVATE = new Set(["1", "true", "yes", "on"]);

function allowPrivate(): boolean {
  return ALLOW_PRIVATE.has((process.env.VERIFYLIVE_ALLOW_PRIVATE_NETWORK ?? "").toLowerCase());
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

export type SafeUrlOptions = {
  /**
   * Allows a private or loopback host for THIS url only. Reserved for an
   * origin the operator configured themselves, such as a SearXNG instance on
   * localhost. Never set it for a URL that came from the open web, and note
   * that redirect hops leaving that origin are still checked normally.
   */
  trustedOrigin?: boolean;
};

/**
 * SSRF guard: the app accepts URLs from the open web and follows redirects.
 * Resolve first, then connect to the resolved literal where we can, and
 * re-validate every redirect hop.
 */
export async function assertSafeUrl(rawUrl: string, options: SafeUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("URL inválida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Solo se permiten URLs http/https");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Las URLs con credenciales no están permitidas");
  }
  const hostname = url.hostname.toLowerCase();
  const permitted = allowPrivate() || options.trustedOrigin === true;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    if (!permitted) throw new UnsafeUrlError("Host interno bloqueado");
  }
  if (permitted) return url;

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeUrlError("Dirección IP privada bloqueada");
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError("No se pudo resolver el host");
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrlError("El host resuelve a una red privada");
  }
  return url;
}

export type SafeFetchResult = {
  url: string;
  contentType: string;
  text: string;
};

/**
 * GET-only fetch with manual redirects, per-hop validation, hard timeout and
 * a byte ceiling. Custom headers are dropped after a cross-origin redirect.
 */
export async function safeFetchText(
  rawUrl: string,
  options: {
    timeoutMs: number;
    maxBytes?: number;
    headers?: Record<string, string>;
    trustedOrigin?: boolean;
  } = { timeoutMs: 8_000 },
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 1_500_000;
  const deadline = Date.now() + options.timeoutMs;
  const trusted = options.trustedOrigin === true;
  let current = await assertSafeUrl(rawUrl, { trustedOrigin: trusted });
  const trustedOrigin = trusted ? current.origin : null;
  // El Accept por defecto sirve para raspar páginas, pero iba después del de
  // quien llama y lo pisaba: la API de Brave rechazaba la petición con un 422
  // porque solo admite application/json. Lo explícito manda.
  let headers: Record<string, string> = {
    Accept: "text/plain, text/html;q=0.9, application/json;q=0.8",
    ...(options.headers ?? {}),
  };

  for (let hop = 0; hop < 4; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UnsafeUrlError("Tiempo de conexión agotado");
    const response = await fetch(current, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new UnsafeUrlError("Redirección sin destino");
      const next = new URL(location, current);
      const sameOrigin = next.origin === current.origin;
      // The exemption follows the configured origin, never a hop off it.
      current = await assertSafeUrl(next.toString(), {
        trustedOrigin: next.origin === trustedOrigin,
      });
      if (!sameOrigin) {
        headers = { ...headers };
        delete headers.Authorization;
      }
      continue;
    }

    if (!response.ok) {
      // El cuerpo explica el motivo: las APIs de búsqueda devuelven 4xx con un
      // mensaje concreto, y tirarlo dejaba "HTTP 422" sin forma de diagnosticar.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status}${detail ? `: ${detail.slice(0, 600)}` : ""}`,
      );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new UnsafeUrlError("Respuesta demasiado grande");

    const reader = response.body?.getReader();
    if (!reader) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) throw new UnsafeUrlError("Respuesta demasiado grande");
      return {
        url: current.toString(),
        contentType: response.headers.get("content-type") ?? "",
        text: new TextDecoder().decode(buffer),
      };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UnsafeUrlError("Respuesta demasiado grande");
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      url: current.toString(),
      contentType: response.headers.get("content-type") ?? "",
      text: new TextDecoder().decode(merged),
    };
  }

  throw new UnsafeUrlError("Demasiadas redirecciones");
}
