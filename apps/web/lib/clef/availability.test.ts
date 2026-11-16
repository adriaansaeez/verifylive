import { afterEach, describe, expect, it } from "vitest";
import { markRetired, resetAvailability, retiredReason } from "@/lib/clef/availability";
import { configuredProviders } from "@/lib/clef/providers";
import { runtimeConfig } from "@/lib/config";

afterEach(() => {
  resetAvailability();
  delete process.env.NAN_KEY;
  delete process.env.TYPESAFE_API_KEY;
});

describe("cadena de evaluadores", () => {
  it("sin claves no hay evaluador y el modo es simulado", () => {
    expect(configuredProviders()).toHaveLength(0);
    expect(runtimeConfig().clefMode).toBe("simulated");
    expect(runtimeConfig().decider).toBeNull();
  });

  it("usa Clef mientras responda", () => {
    process.env.NAN_KEY = "una-clave";
    process.env.TYPESAFE_API_KEY = "otra-clave";
    expect(runtimeConfig().clefMode).toBe("live");
    expect(runtimeConfig().decider).toBe("Clef · NaN");
  });

  it("releva en Jev cuando Clef se retira, sin caer a simulado", () => {
    process.env.NAN_KEY = "una-clave";
    process.env.TYPESAFE_API_KEY = "otra-clave";
    markRetired("clef", "El servicio ya no sirve el modelo «clef».");

    const config = runtimeConfig();
    expect(config.clefMode).toBe("live");
    expect(config.decider).toBe("Jev · TypeSafe");
    expect(config.clefNote).toContain("clef");
  });

  it("solo cae a simulado cuando no queda ninguno", () => {
    process.env.NAN_KEY = "una-clave";
    process.env.TYPESAFE_API_KEY = "otra-clave";
    markRetired("clef", "retirado");
    markRetired("jev", "retirado");

    expect(runtimeConfig().clefMode).toBe("simulated");
    expect(runtimeConfig().decider).toBeNull();
    expect(retiredReason("jev")).toBe("retirado");
  });

  it("con solo la clave de Jev, Jev decide", () => {
    process.env.TYPESAFE_API_KEY = "otra-clave";
    expect(runtimeConfig().decider).toBe("Jev · TypeSafe");
  });
});
