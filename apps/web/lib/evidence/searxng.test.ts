import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSearxResults, searchSearxng, searxngBaseUrl } from "./searxng";
import { safeFetchText } from "./ssrf";

vi.mock("./ssrf", () => ({ safeFetchText: vi.fn() }));

afterEach(() => {
  vi.mocked(safeFetchText).mockReset();
  vi.unstubAllEnvs();
});

const PAYLOAD = {
  results: [
    {
      url: "https://www.rtve.es/noticias/20261106/fiscalia-europea/",
      title: "La Fiscalía Europea investiga un presunto fraude en los fondos",
      content: "Con este segundo proceso, la Fiscalía Europea investiga los posibles delitos contra los fondos de la Unión.",
      publishedDate: "2026-11-06T00:00:00",
      engine: "duckduckgo",
    },
    {
      url: "https://www.renfe.com/es/es",
      title: "Billetes de tren AVE al mejor precio",
      content: "Compra tus billetes.",
      engine: "brave",
    },
    { url: "not a url", title: "Rota", content: "x" },
    {
      url: "https://www.rtve.es/noticias/20261106/fiscalia-europea/",
      title: "Duplicada",
      content: "La misma noticia otra vez.",
      engine: "startpage",
    },
  ],
};

describe("parseSearxResults", () => {
  it("keeps the publisher URL, the snippet and the date", () => {
    const [first] = parseSearxResults(PAYLOAD, 10);
    expect(first).toMatchObject({
      url: "https://www.rtve.es/noticias/20261106/fiscalia-europea/",
      publisher: "rtve.es",
      publishedAt: "2026-11-06T00:00:00",
      sourceTier: "reliable_secondary",
    });
    expect(first?.excerpt).toContain("Fiscalía Europea");
  });

  it("records which engine answered, for the traceability panel", () => {
    expect(parseSearxResults(PAYLOAD, 10)[0]?.connector).toBe("websearch:searxng/duckduckgo");
  });

  it("drops ticket shops, broken URLs and duplicates", () => {
    const urls = parseSearxResults(PAYLOAD, 10).map((item) => item.url);
    expect(urls).toEqual(["https://www.rtve.es/noticias/20261106/fiscalia-europea/"]);
  });

  it("respects the result limit", () => {
    const many = { results: Array.from({ length: 30 }, (_, index) => ({
      url: `https://example.org/${index}`, title: `Noticia ${index}`, content: "Un texto suficiente.",
    })) };
    expect(parseSearxResults(many, 8)).toHaveLength(8);
  });

  it("returns nothing for a payload that is not a result list", () => {
    expect(parseSearxResults({ error: "boom" }, 8)).toEqual([]);
    expect(parseSearxResults(null, 8)).toEqual([]);
  });
});

describe("searxngBaseUrl", () => {
  it("is off unless configured", () => {
    expect(searxngBaseUrl()).toBeNull();
  });

  it("normalises a configured origin", () => {
    vi.stubEnv("VERITAS_SEARXNG_URL", "http://localhost:8099/");
    expect(searxngBaseUrl()).toBe("http://localhost:8099");
  });

  it("ignores a malformed value instead of failing the claim", () => {
    vi.stubEnv("VERITAS_SEARXNG_URL", "no-es-una-url");
    expect(searxngBaseUrl()).toBeNull();
  });
});

describe("searchSearxng", () => {
  it("asks for JSON in Spanish and trusts only the configured origin", async () => {
    vi.stubEnv("VERITAS_SEARXNG_URL", "http://localhost:8099");
    vi.mocked(safeFetchText).mockResolvedValue({
      url: "http://localhost:8099/search",
      contentType: "application/json",
      text: JSON.stringify(PAYLOAD),
    });

    const results = await searchSearxng("auditoría seguridad Madrid Sevilla");

    expect(results).toHaveLength(1);
    const [calledUrl, options] = vi.mocked(safeFetchText).mock.calls[0] ?? [];
    expect(calledUrl).toContain("format=json");
    expect(calledUrl).toContain("language=es");
    // Loopback is blocked by the SSRF guard unless the call opts in, and only
    // the operator's own origin may do so.
    expect(options).toMatchObject({ trustedOrigin: true });
  });

  it("stays quiet when no instance is configured", async () => {
    expect(await searchSearxng("lo que sea")).toEqual([]);
    expect(safeFetchText).not.toHaveBeenCalled();
  });

  it("returns nothing when the instance answers something that is not JSON", async () => {
    vi.stubEnv("VERITAS_SEARXNG_URL", "http://localhost:8099");
    vi.mocked(safeFetchText).mockResolvedValue({
      url: "http://localhost:8099/search",
      contentType: "text/html",
      text: "<html>403</html>",
    });
    expect(await searchSearxng("lo que sea")).toEqual([]);
  });
});
