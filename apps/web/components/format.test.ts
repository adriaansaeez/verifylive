import { describe, expect, it } from "vitest";
import { clock, pct, plural, quality } from "./format";

describe("pct", () => {
  it("renders a probability", () => {
    expect(pct(0.891)).toBe("89%");
    expect(pct(0)).toBe("0%");
  });
});

describe("clock", () => {
  it("renders a position in the recording", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(259_600)).toBe("4:20");
  });
});

describe("quality", () => {
  it("renders the 0-4 evidence level as a level, never as a percentage", () => {
    // pct() showed a score of 1.3 as "130%" in the drawer.
    expect(quality(1.3)).toBe("Débil (1.3 de 4)");
    expect(quality(4)).toBe("Primaria y concluyente (4.0 de 4)");
    expect(quality(0)).toBe("Ninguna (0.0 de 4)");
  });

  it("clamps a score outside the scale", () => {
    expect(quality(9)).toBe("Primaria y concluyente (4.0 de 4)");
    expect(quality(-1)).toBe("Ninguna (0.0 de 4)");
  });
});

describe("plural", () => {
  it("agrees with the count", () => {
    expect(plural(1, "resultado", "resultados")).toBe("1 resultado");
    expect(plural(0, "resultado", "resultados")).toBe("0 resultados");
    expect(plural(3, "tramo candidato", "tramos candidatos")).toBe("3 tramos candidatos");
  });
});
