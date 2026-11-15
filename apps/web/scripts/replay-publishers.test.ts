/**
 * Publisher classification harness.
 *
 * Takes the real hosts that today's captures put in the "other" bucket and
 * checks what the classifier makes of them, against a hand-made answer key.
 * This is the measurement behind replacing a hand-kept domain list: ten of the
 * thirteen claims that depended only on "other" sources were in fact backed by
 * real newspapers.
 *
 *   VERITAS_REPLAY=1 npx vitest run scripts/replay-publishers.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPublishers, type PublisherStore, type PublisherTier } from "@/lib/evidence/publisher";
import { classifyTier } from "@/lib/evidence/rank";

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const index = line.indexOf("=");
      if (index <= 0 || line.trimStart().startsWith("#")) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

/** Answer key: every host the live captures cited, judged by hand. */
const EXPECTED: [string, PublisherTier][] = [
  // Prensa nacional y regional española que la lista fija no conocía.
  ["larazon.es", "reliable_secondary"],
  ["vozpopuli.com", "reliable_secondary"],
  ["theobjective.com", "reliable_secondary"],
  ["elconfidencialdigital.com", "reliable_secondary"],
  ["huffingtonpost.es", "reliable_secondary"],
  ["lne.es", "reliable_secondary"],
  ["lasprovincias.es", "reliable_secondary"],
  ["laprovincia.es", "reliable_secondary"],
  ["diariosur.es", "reliable_secondary"],
  ["noticiasdenavarra.com", "reliable_secondary"],
  ["diariodevalladolid.es", "reliable_secondary"],
  ["lavozdelsur.es", "reliable_secondary"],
  ["melillahoy.es", "reliable_secondary"],
  ["objetivocastillalamancha.es", "reliable_secondary"],
  ["clm24.es", "reliable_secondary"],
  ["elespanol.com", "reliable_secondary"],
  ["elplural.com", "reliable_secondary"],
  ["eldebate.com", "reliable_secondary"],
  ["lamarea.com", "reliable_secondary"],
  ["que.es", "reliable_secondary"],
  ["democrata.es", "reliable_secondary"],
  ["esdiario.com", "reliable_secondary"],
  ["cuatro.com", "reliable_secondary"],
  ["elcorreogallego.es", "reliable_secondary"],
  ["laopiniondemurcia.es", "reliable_secondary"],
  ["laverdad.es", "reliable_secondary"],
  ["gaceta.es", "reliable_secondary"],
  // Prensa extranjera en español.
  ["infobae.com", "reliable_secondary"],
  ["clarin.com", "reliable_secondary"],
  ["prensalibre.com", "reliable_secondary"],
  ["elobservador.com.uy", "reliable_secondary"],
  ["ambito.com", "reliable_secondary"],
  // Nada de esto es periodismo.
  ["dle.rae.es", "other"],
  ["youtube.com", "other"],
  ["dailymotion.com", "other"],
  ["jobrise.io", "other"],
  ["mevoyalmundo.com", "other"],
  ["suizaespanol.com", "other"],
  ["diarium.usal.es", "other"],
  ["realestatemarket.com.mx", "other"],
  ["barriosalvadormadrid.com", "other"],
];

const enabled = process.env.VERITAS_REPLAY === "1" && Boolean(process.env.NAN_KEY?.trim());

describe.skipIf(!enabled)("publisher classification", () => {
  it(
    "places the outlets the hand-kept list could not",
    { timeout: 10 * 60_000 },
    async () => {
      const map = new Map<string, PublisherTier>();
      const store: PublisherStore = {
        get: (host) => map.get(host) ?? null,
        set: (host, tier) => void map.set(host, tier),
      };

      const started = Date.now();
      const resolved = await classifyPublishers(EXPECTED.map(([host]) => host), store);
      const ms = Date.now() - started;

      const rows = EXPECTED.map(([host, expected]) => {
        const before = classifyTier(`https://${host}/`);
        const after = resolved.get(host) ?? "other";
        return { host, expected, before, after, ok: after === expected };
      });

      const hits = rows.filter((row) => row.ok).length;
      const rescued = rows.filter((row) => row.before === "other" && row.after !== "other" && row.ok);
      const wrong = rows.filter((row) => !row.ok);

      console.log(
        [
          "",
          `dominios clasificados: ${rows.length} en ${(ms / 1000).toFixed(1)} s`,
          `aciertos:              ${hits}/${rows.length} (${Math.round((hits / rows.length) * 100)}%)`,
          `rescatados de "other": ${rescued.length}`,
          "",
          ...rows.map(
            (row) =>
              `${row.ok ? "ok " : "XX "} ${row.host.padEnd(30)} lista=${row.before.padEnd(19)} modelo=${row.after}`,
          ),
          "",
          wrong.length > 0 ? `fallos: ${wrong.map((row) => `${row.host} (esperado ${row.expected}, dio ${row.after})`).join(", ")}` : "fallos: ninguno",
          "",
        ].join("\n"),
      );

      // The hand-kept list placed none of these.
      expect(rescued.length).toBeGreaterThanOrEqual(20);
      expect(hits / rows.length).toBeGreaterThanOrEqual(0.85);
      // Being wrong about a newspaper only costs a caveat; calling a job board
      // a newspaper puts a bad source behind a firm verdict.
      const falsePress = rows.filter((row) => row.expected === "other" && row.after !== "other");
      expect(falsePress).toEqual([]);
    },
  );
});
