import { afterEach, describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/redact";

afterEach(() => {
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

describe("redactSecrets", () => {
  it("borra el valor exacto de una clave configurada", () => {
    process.env.BRAVE_SEARCH_API_KEY = "BSA9MSYDvcSFMJAH8fNmQ6W4UwkVcyd";
    const out = redactSecrets('HTTP 401: {"token":"BSA9MSYDvcSFMJAH8fNmQ6W4UwkVcyd"}');
    expect(out).not.toContain("BSA9MSYDvcSFMJAH8fNmQ6W4UwkVcyd");
    expect(out).toContain("«oculto»");
  });

  it("borra la clave de una URL, que es como la manda Google", () => {
    const out = redactSecrets("fallo en https://www.googleapis.com/customsearch/v1?key=AIzaSyC_ejemplo_de_clave_larga_123456&cx=abc");
    expect(out).not.toContain("AIzaSyC_ejemplo_de_clave_larga_123456");
    expect(out).toContain("key=«oculto»");
  });

  it("no toca un texto sin secretos", () => {
    const text = "HTTP 422: Unable to validate request parameter(s)";
    expect(redactSecrets(text)).toBe(text);
  });

  it("ignora valores demasiado cortos para no destrozar texto normal", () => {
    process.env.GOOGLE_API_KEY = "es";
    expect(redactSecrets("la respuesta es correcta")).toBe("la respuesta es correcta");
  });
});
