import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWikipedia } from "./wikipedia";
import { gatherEvidence } from "./index";

vi.mock("./wikipedia", () => ({ searchWikipedia: vi.fn(async () => []) }));
vi.mock("./websearch", () => ({ searchWeb: vi.fn(async () => []) }));
vi.mock("./jina", () => ({ searchJina: vi.fn(async () => []) }));

afterEach(() => {
  vi.mocked(searchWikipedia).mockClear();
  vi.unstubAllEnvs();
});

describe("gatherEvidence", () => {
  it("does not schedule Wikipedia when VERIFYLIVE_ENABLE_WIKIPEDIA is disabled", async () => {
    vi.stubEnv("VERIFYLIVE_ENABLE_WIKIPEDIA", "false");
    vi.stubEnv("VERIFYLIVE_SEARCH_PROVIDER", "none");

    const result = await gatherEvidence(
      { text: "Afirmación zafiro quasar sin corpus", searchQueries: ["zafiro quasar"] },
      { mode: "live" },
    );

    expect(searchWikipedia).not.toHaveBeenCalled();
    expect(result.connectors.some((connector) => connector.name.startsWith("wikipedia"))).toBe(false);
  });

  it("schedules Wikipedia when the flag is enabled", async () => {
    vi.stubEnv("VERIFYLIVE_ENABLE_WIKIPEDIA", "true");
    vi.stubEnv("VERIFYLIVE_SEARCH_PROVIDER", "none");

    await gatherEvidence(
      { text: "Afirmación ámbar nebula sin corpus", searchQueries: ["ámbar nebula"] },
      { mode: "live" },
    );

    expect(searchWikipedia).toHaveBeenCalledTimes(2);
  });
});
