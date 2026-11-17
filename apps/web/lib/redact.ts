/**
 * Quita secretos de un texto antes de guardarlo o enseñarlo.
 *
 * Los errores de los conectores se guardan en los diagnósticos de cada
 * veredicto y la API los devuelve, así que cualquier cosa que acabe en un
 * mensaje de error es pública para quien pueda leer la sesión. Y hay motivos
 * reales para que una clave acabe ahí: Google CSE la manda en la URL, y una
 * API puede repetir en su error la petición que le llegó.
 */
const SECRET_VARS = [
  "NAN_KEY",
  "TYPESAFE_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CSE_ID",
  "BRAVE_SEARCH_API_KEY",
  "JINA_API_KEY",
  "VERIFYLIVE_API_TOKEN",
];

/** Formas habituales de clave, por si llega una que no es nuestra. */
const PATTERNS = [
  /\bapikey_[A-Za-z0-9_]{16,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bBS[A-Za-z0-9_-]{25,}/g,
  /([?&](?:key|api_key|token|access_token)=)[^&\s"']+/gi,
];

export function redactSecrets(text: string): string {
  let output = text;
  for (const name of SECRET_VARS) {
    const value = process.env[name]?.trim();
    // Un valor corto daría falsos positivos sobre texto normal.
    if (value && value.length >= 8) output = output.split(value).join("«oculto»");
  }
  for (const pattern of PATTERNS) {
    output = output.replace(pattern, (match, prefix: string | undefined) =>
      prefix ? `${prefix}«oculto»` : "«oculto»",
    );
  }
  return output;
}
