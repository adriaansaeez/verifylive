import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyPublishers,
  hostOf,
  isNeverPress,
  parsePublisherTier,
  type PublisherStore,
  type PublisherTier,
} from "./publisher";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function memoryStore(seed: Record<string, PublisherTier> = {}): PublisherStore & { writes: string[] } {
  const map = new Map<string, PublisherTier>(Object.entries(seed));
  const writes: string[] = [];
  return {
    writes,
    get: (host) => map.get(host) ?? null,
    set: (host, tier) => {
      writes.push(host);
      map.set(host, tier);
    },
  };
}

function answer(tier: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tier }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("isNeverPress", () => {
  it("rules out reference works, platforms and job boards", () => {
    expect(isNeverPress("dle.rae.es")).toBe(true);
    expect(isNeverPress("www.youtube.com")).toBe(true);
    expect(isNeverPress("jobrise.io")).toBe(true);
    expect(isNeverPress("algo.blogspot.com")).toBe(true);
  });

  it("leaves newspapers alone", () => {
    expect(isNeverPress("larazon.es")).toBe(false);
    expect(isNeverPress("noticiasdenavarra.com")).toBe(false);
  });
});

describe("parsePublisherTier", () => {
  it("reads the tier out of the model's JSON", () => {
    expect(parsePublisherTier('{"tier":"reliable_secondary"}')).toBe("reliable_secondary");
    expect(parsePublisherTier('Claro:\n{"tier": "primary"}\n')).toBe("primary");
  });

  it("refuses anything that is not one of the three tiers", () => {
    expect(parsePublisherTier('{"tier":"muy fiable"}')).toBeNull();
    expect(parsePublisherTier("no json")).toBeNull();
    expect(parsePublisherTier("")).toBeNull();
  });
});

describe("hostOf", () => {
  it("normalises the host and drops www", () => {
    expect(hostOf("https://www.LaRazon.es/articulo")).toBe("larazon.es");
    expect(hostOf("no-es-una-url")).toBeNull();
  });
});

describe("classifyPublishers", () => {
  it("asks the model once per unknown host and remembers the answer", async () => {
    vi.stubEnv("NAN_KEY", "k");
    vi.stubEnv("NAN_CHAT_MODEL", "m");
    const fetchMock = vi.fn(async () => answer("reliable_secondary"));
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore();

    const first = await classifyPublishers(["larazon.es", "www.larazon.es"], store);
    expect(first.get("larazon.es")).toBe("reliable_secondary");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await classifyPublishers(["larazon.es"], store);
    expect(second.get("larazon.es")).toBe("reliable_secondary");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.writes).toEqual(["larazon.es"]);
  });

  it("answers from the store without calling anyone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore({ "elpais.com": "reliable_secondary" });

    expect((await classifyPublishers(["elpais.com"], store)).get("elpais.com")).toBe("reliable_secondary");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never spends a call on a host that is never journalism", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore();

    expect((await classifyPublishers(["dle.rae.es"], store)).get("dle.rae.es")).toBe("other");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to other when the model fails, but never caches that failure", async () => {
    // A 429 used to be remembered as "this is not a newspaper", for good.
    vi.stubEnv("NAN_KEY", "k");
    vi.stubEnv("NAN_CHAT_MODEL", "m");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const store = memoryStore();

    expect((await classifyPublishers(["larazon.es"], store)).get("larazon.es")).toBe("other");
    expect(store.get("larazon.es")).toBeNull();
    expect(store.writes).toEqual([]);
  });

  it("retries a throttled host instead of writing it off", async () => {
    vi.stubEnv("NAN_KEY", "k");
    vi.stubEnv("NAN_CHAT_MODEL", "m");
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      return call === 1 ? new Response("slow down", { status: 429 }) : answer("reliable_secondary");
    }));
    const store = memoryStore();

    const resolved = await classifyPublishers(["larazon.es"], store);
    expect(resolved.get("larazon.es")).toBe("reliable_secondary");
    expect(call).toBe(2);
  });

  it("asks one host at a time, so a batch cannot trip the rate limit", async () => {
    vi.stubEnv("NAN_KEY", "k");
    vi.stubEnv("NAN_CHAT_MODEL", "m");
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return answer("reliable_secondary");
    }));

    await classifyPublishers(["a.example", "b.example", "c.example"], memoryStore());
    expect(peak).toBe(1);
  });

  it("works with no chat model configured at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore();

    expect((await classifyPublishers(["loquesea.example"], store)).get("loquesea.example")).toBe("other");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
