import { describe, expect, it } from "vitest";
import { ClaimWindow } from "@/lib/claims/claim-window";

describe("ClaimWindow", () => {
  it("offers exact spans when ASR cuts one assertion in two", () => {
    const window = new ClaimWindow();
    window.append({ text: "La inversión se ha multiplicado", startMs: 0, endMs: 5_000 });
    const candidates = window.append({ text: "por veinte durante ocho años.", startMs: 5_000, endMs: 10_000 });

    expect(candidates.map((candidate) => candidate.text)).toEqual([
      "por veinte durante ocho años.",
      "La inversión se ha multiplicado por veinte durante ocho años.",
    ]);
    expect(candidates[1]).toMatchObject({ startMs: 0, endMs: 10_000, partCount: 2 });
  });

  it("still reaches a sentence that closed before the newest filler", () => {
    const window = new ClaimWindow();
    window.append({ text: "La inversión creció un 20% en 2024.", startMs: 0, endMs: 5_000 });
    window.append({ text: "Y bueno, eh, en qué estábamos", startMs: 5_000, endMs: 10_000 });
    const texts = window.candidates().map((candidate) => candidate.text);

    expect(texts).toContain("La inversión creció un 20% en 2024.");
  });

  it("caps how many parts a single span may cover", () => {
    const window = new ClaimWindow(6);
    for (let index = 0; index < 6; index += 1) {
      window.append({ text: `parte ${index}`, startMs: index, endMs: index + 1 });
    }
    const longest = Math.max(...window.candidates().map((candidate) => candidate.partCount));
    expect(longest).toBe(4);
  });

  it("keeps the context bounded", () => {
    const window = new ClaimWindow(3);
    for (let index = 0; index < 5; index += 1) {
      window.append({ text: `fragmento ${index}`, startMs: index, endMs: index + 1 });
    }
    // Sin puntuación el final nunca cierra, así que solo se ofrece el tramo
    // más largo: los más cortos comparten ese mismo final a medias.
    expect(window.candidates()).toHaveLength(1);
    expect(window.candidates()[0]?.text).toBe("fragmento 2 fragmento 3 fragmento 4");
  });

  it("no juzga un tramo que todavía puede crecer", () => {
    const window = new ClaimWindow();
    // Acaba en el borde vivo y sin cerrar frase: el hablante sigue.
    expect(window.append({ text: "Yo he inaugurado pues el ave madrid", startMs: 0, endMs: 1 })).toHaveLength(0);
    // Al cerrarse la frase, el tramo completo ya se puede juzgar.
    const after = window.append({ text: "Ourense y el ave madrid murcia.", startMs: 1, endMs: 2 });
    expect(after.some((c) => c.text.includes("Ourense") && c.text.includes("inaugurado"))).toBe(true);
  });

  it("keeps text after a selected span for the next decision", () => {
    const window = new ClaimWindow();
    window.append({ text: "Un hecho.", startMs: 0, endMs: 1 });
    window.append({ text: "Otro hecho.", startMs: 1, endMs: 2 });
    window.append({ text: "Una opinión.", startMs: 2, endMs: 3 });
    const selected = window.candidates().find((candidate) => candidate.text === "Un hecho. Otro hecho.");
    expect(selected).toBeDefined();
    window.consume(selected);
    expect(window.candidates().map((candidate) => candidate.text)).toEqual(["Una opinión."]);
  });
});
