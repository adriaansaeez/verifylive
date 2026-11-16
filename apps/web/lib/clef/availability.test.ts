import { afterEach, describe, expect, it } from "vitest";
import {
  clefUnavailableReason,
  markClefUnavailable,
  resetClefAvailability,
} from "@/lib/clef/availability";
import { runtimeConfig } from "@/lib/config";

afterEach(() => {
  resetClefAvailability();
  delete process.env.NAN_KEY;
});

describe("disponibilidad de Clef", () => {
  it("empieza sin diagnóstico", () => {
    expect(clefUnavailableReason()).toBeNull();
  });

  it("deja de decir «en vivo» cuando el modelo ya no se sirve", () => {
    process.env.NAN_KEY = "una-clave";
    expect(runtimeConfig().clefMode).toBe("live");

    markClefUnavailable("retirado del servicio");

    // Con clave pero sin modelo, decir «en vivo» sería falso: el camino
    // correcto es el clasificador local, que va etiquetado como simulado.
    expect(runtimeConfig().clefMode).toBe("simulated");
    expect(clefUnavailableReason()).toBe("retirado del servicio");
  });

  it("sin clave sigue siendo simulado", () => {
    expect(runtimeConfig().clefMode).toBe("simulated");
  });
});
