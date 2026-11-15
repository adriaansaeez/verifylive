import { describe, expect, it } from "vitest";
import { embedUrl, parseYoutube } from "@/lib/client/youtube";

describe("parseYoutube", () => {
  it("lee las formas habituales de enlace", () => {
    const forms = [
      "https://www.youtube.com/watch?v=TlbvCOqf9-o",
      "https://youtu.be/TlbvCOqf9-o",
      "https://www.youtube.com/embed/TlbvCOqf9-o",
      "https://www.youtube.com/live/TlbvCOqf9-o",
      "https://www.youtube.com/shorts/TlbvCOqf9-o",
      "youtube.com/watch?v=TlbvCOqf9-o",
      "TlbvCOqf9-o",
    ];
    for (const form of forms) {
      expect(parseYoutube(form), form).toMatchObject({ id: "TlbvCOqf9-o" });
    }
  });

  it("conserva el minuto de inicio en los dos formatos", () => {
    expect(parseYoutube("https://youtu.be/TlbvCOqf9-o?t=90")?.startSeconds).toBe(90);
    expect(parseYoutube("https://www.youtube.com/watch?v=TlbvCOqf9-o&t=1m30s")?.startSeconds).toBe(90);
    expect(parseYoutube("https://www.youtube.com/watch?v=TlbvCOqf9-o&t=1h2m3s")?.startSeconds).toBe(3723);
  });

  it("no acepta otra cosa, y no lanza", () => {
    for (const bad of ["", "   ", "no es una url", "https://vimeo.com/12345", "https://www.youtube.com/watch?v=corto", "https://youtube.com/"]) {
      expect(parseYoutube(bad), bad).toBeNull();
    }
  });
});

describe("embedUrl", () => {
  it("usa el dominio sin cookies y fija el origen", () => {
    const url = embedUrl({ id: "TlbvCOqf9-o", startSeconds: 42 }, "http://localhost:3123");
    expect(url).toContain("https://www.youtube-nocookie.com/embed/TlbvCOqf9-o?");
    expect(url).toContain("start=42");
    expect(url).toContain("origin=http%3A%2F%2Flocalhost%3A3123");
  });
});
