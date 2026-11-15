import { afterEach, describe, expect, it, vi } from "vitest";
import { keywordQuery } from "@/lib/claims/heuristic";
import { hitMatchesQuery, searchWeb, unwrapBingRedirect } from "./websearch";
import { tokenize } from "@/lib/text";
import { safeFetchText } from "./ssrf";

vi.mock("./ssrf", () => ({ safeFetchText: vi.fn() }));

afterEach(() => {
  vi.mocked(safeFetchText).mockReset();
  vi.unstubAllEnvs();
});

describe("keywordQuery", () => {
  it("drops filler from spoken sentences", () => {
    const query = keywordQuery("Quiero empezar con un dato que resume la situación");
    expect(query).not.toContain("dato");
    expect(query).not.toContain("situacion");
  });

  it("keeps entities and rewritten numbers", () => {
    const query = keywordQuery("El presidente creó quinientos mil empleos, un récord histórico");
    expect(query).toContain("presidente");
    expect(query).toContain("empleos");
  });
});

describe("hitMatchesQuery", () => {
  const tokens = tokenize("presidente empleos record");

  it("keeps a hit that shares meaningful tokens", () => {
    expect(hitMatchesQuery("Récord de empleo en España", "Se crearon 500.000 empleos", tokens)).toBe(true);
  });

  it("drops unrelated dictionary and date pages", () => {
    expect(hitMatchesQuery("año - Diccionario RAE", "Definición de año", tokens)).toBe(false);
  });

  it("needs more evidence for long queries", () => {
    expect(hitMatchesQuery("Empleos", "ofertas de empleo", ["presidente", "empleos", "record", "historico"])).toBe(false);
    expect(
      hitMatchesQuery("Presidente anuncia récord de empleos", "el presidente habló del récord", [
        "presidente",
        "empleos",
        "record",
        "historico",
      ]),
    ).toBe(true);
  });
});

describe("searchWeb", () => {
  it("keeps the fallback provider and classifies each result URL", async () => {
    vi.stubEnv("VERITAS_SEARCH_PROVIDER", "google");
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_CSE_ID", "test-cx");
    const longDescription = "clima prueba fallback ".repeat(15);
    vi.mocked(safeFetchText).mockImplementation(async (url) => {
      if (url.includes("googleapis.com")) {
        return { url, contentType: "application/json", text: "{}" };
      }
      return {
        url,
        contentType: "application/rss+xml",
        text: `<rss><channel><item><title>Informe de clima</title><link>https://nasa.gov/climate/report</link><description>${longDescription}</description></item></channel></rss>`,
      };
    });

    const results = await searchWeb("clima prueba fallback provider");

    expect(results).toHaveLength(1);
    expect(results[0]?.connector).toBe("websearch:bingnews");
    expect(results[0]?.sourceTier).toBe("primary");
  });

  it("drops ticket shops and aggregators, whatever the keywords match", async () => {
    vi.stubEnv("VERITAS_SEARCH_PROVIDER", "bingnews");
    const description = "AVE Madrid Ourense billetes y horarios ".repeat(8);
    vi.mocked(safeFetchText).mockImplementation(async (url) => ({
      url,
      contentType: "application/rss+xml",
      text:
        "<rss><channel>" +
        `<item><title>Billetes AVE Madrid Ourense</title><link>https://www.renfe.com/es/es</link><description>${description}</description></item>` +
        `<item><title>El AVE Madrid Ourense entra en servicio</title><link>https://www.rtve.es/noticias/ave-madrid-ourense</link><description>${description}</description></item>` +
        "</channel></rss>",
    }));

    const results = await searchWeb("AVE Madrid Ourense inauguración");

    expect(results.map((item) => item.url)).toEqual([
      "https://www.rtve.es/noticias/ave-madrid-ourense",
    ]);
  });
});

describe("unwrapBingRedirect", () => {
  const hit = {
    title: "El Gobierno aprueba el refuerzo en la seguridad ferroviaria",
    snippet: "El Consejo de Ministros aprobó nuevas inspecciones.",
    publisher: null,
    publishedAt: null,
  };

  it("recovers the publisher URL from a news redirect", () => {
    expect(
      unwrapBingRedirect({
        ...hit,
        url: "http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2felpais.com%2fespana%2f2026-11-10%2frefuerzo.html",
      })?.url,
    ).toBe("https://elpais.com/espana/2026-11-10/refuerzo.html");
  });

  it("drops a redirect that carries no target: a redirector is not a citation", () => {
    expect(unwrapBingRedirect({ ...hit, url: "http://www.bing.com/news/apiclick.aspx?ref=FexRss" })).toBeNull();
  });

  it("leaves a direct publisher URL untouched", () => {
    expect(unwrapBingRedirect({ ...hit, url: "https://rtve.es/noticia" })?.url).toBe("https://rtve.es/noticia");
  });
});
