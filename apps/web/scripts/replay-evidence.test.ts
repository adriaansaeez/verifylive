/**
 * Evidence and verdict harness.
 *
 * Takes spans the gate actually published from the captured rail interview,
 * runs the real canonicalizer, the real connectors and the real verdict
 * policy, and prints which sources each claim ended up with. This is how the
 * source-selection fixes were verified: the keyless web search answered "AVE
 * Madrid Ourense inauguración" with four ticket shops, and that is exactly
 * what this harness shows or clears.
 *
 *   VERIFYLIVE_REPLAY=1 npx vitest run scripts/replay-evidence.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeClaim } from "@/lib/claims/canonicalize";
import { buildQueries } from "@/lib/claims/heuristic";
import { gatherEvidence } from "@/lib/evidence";
import { isExcludedHost } from "@/lib/evidence/websearch";
import { applyVerdictPolicy } from "@/lib/verdict/policy";
import { buildQuestions, callClefRaw, parseClefResponse } from "@/lib/clef/client";
import { clip, normalizeText } from "@/lib/text";
import type { Claim, Evidence } from "@/lib/types";

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

/** Spans taken verbatim from the detection replay output. */
const SPANS = [
  "de dos mil veintiséis a dos mil treinta que en función de los criterios técnicos que nos han dicho vamos a invertir diecinueve cero millones de euros en el mantenimiento y la seguridad de las vías ferroviarias, ¿no?",
  "Eh, se da la particularidad de que en el eh, en la línea en la que se han concentrado los dos desgraciados accidentes ferroviarios, nosotros hemos multiplicado por veinte durante estos últimos ocho años por veinte la inversión.",
  "Yo he inaugurado pues el ave madrid Ourense el ave madrid murcia bueno y tres el mantenimiento también de todas esas vías.",
  "en nuestro país, pese a las dificultades, es un sistema seguro.",
  "15 años hemos tardado en revertir esos recortes en lo que es la inversión en el sistema ferroviario.",
  "Una auditoría extraordinaria de seguridad de la línea Madrid Sevilla y también un compromiso.",
];

const enabled = process.env.VERIFYLIVE_REPLAY === "1" && Boolean(process.env.NAN_KEY?.trim());

function claimFrom(text: string, quote: string, queries: string[]): Claim {
  const now = new Date().toISOString();
  return {
    id: "clm_replay",
    sessionId: "ses_replay",
    segmentId: "seg_replay",
    text,
    normalizedText: normalizeText(text),
    quote,
    startMs: 0,
    endMs: 1,
    status: "detected",
    checkability: "likely_fact",
    searchQueries: queries,
    dedupeKey: "replay",
    attempts: 0,
    error: null,
    detectedAt: now,
    resolvedAt: null,
    updatedAt: now,
  };
}

describe.skipIf(!enabled)("evidence replay", () => {
  it(
    "cites real sources for the claims of a captured interview",
    { timeout: 15 * 60_000 },
    async () => {
      const lines: string[] = [];
      let withSources = 0;
      let excluded = 0;
      const verdicts: string[] = [];

      for (const span of SPANS) {
        const canonical = await canonicalizeClaim(span, {
          spokenAtMs: 0,
          session: { createdAt: new Date().toISOString(), sourceType: "tab" },
        });
        const statements = canonical.length > 0
          ? canonical
          : [{ statement: clip(span, 240), queries: buildQueries(span) }];

        for (const statement of statements) {
          const claim = claimFrom(statement.statement, span, statement.queries);
          const bundle = await gatherEvidence(claim, { mode: "live" });
          const evidence: Evidence[] = bundle.candidates.map((candidate, index) => ({
            id: `ev_${index}`,
            claimId: claim.id,
            url: candidate.url,
            title: candidate.title,
            publisher: candidate.publisher ?? null,
            publishedAt: candidate.publishedAt ?? null,
            retrievedAt: new Date().toISOString(),
            excerpt: candidate.excerpt,
            sourceTier: candidate.sourceTier,
            stance: candidate.stance ?? null,
            connector: candidate.connector,
            score: 0,
            createdAt: new Date().toISOString(),
          }));

          const state = JSON.stringify({
            instruction:
              "Evalúa la afirmación usando SOLO la evidencia adjunta. Si la evidencia no alcanza, dilo. No uses conocimiento externo.",
            claim: claim.text,
            evidence: evidence.map((item) => ({
              title: item.title,
              url: item.url,
              publisher: item.publisher,
              published_at: item.publishedAt,
              source_tier: item.sourceTier,
              excerpt: item.excerpt,
            })),
          });
          const parsed = parseClefResponse(await callClefRaw(state, buildQuestions()));
          const decision = applyVerdictPolicy({
            clef: parsed,
            evidence: bundle.candidates,
            claimText: claim.text,
            checkability: claim.checkability,
            evidenceCount: evidence.length,
          });

          if (evidence.length > 0) withSources += 1;
          excluded += evidence.filter((item) => isExcludedHost(item.url)).length;
          verdicts.push(decision.verdict);

          lines.push(
            "",
            `CLAIM  ${claim.text}`,
            `  queries   ${statement.queries.join(" | ")}`,
            `  conectores ${bundle.connectors.map((run) => `${run.name}=${run.ok ? run.count : `ERR(${run.error ?? "?"})`}/${run.ms}ms`).join("  ")}`,
            `  rerank    descartadas=${bundle.droppedByRerank}`,
            `  veredicto ${decision.verdict} conf=${decision.confidence.toFixed(2)} provisional=${decision.provisional}`,
            ...evidence.map(
              (item) =>
                `   - [${item.sourceTier}] ${item.publisher ?? "?"} ${item.publishedAt ? `(${item.publishedAt.slice(0, 16)})` : ""}\n     ${item.title}\n     ${item.url}`,
            ),
          );
        }
      }

      console.log(
        [
          "",
          `claims con al menos una fuente: ${withSources}/${verdicts.length}`,
          `fuentes de dominios excluidos:  ${excluded}`,
          `veredictos: ${verdicts.join(", ")}`,
          ...lines,
          "",
        ].join("\n"),
      );

      // A ticket shop must never reach the evidence list.
      expect(excluded).toBe(0);
      // Before the fix every claim of this interview ended unverifiable with
      // nothing but topical Wikipedia pages. Live search is volatile, so this
      // is a floor on a smoke test, not a fixed expectation.
      expect(withSources).toBeGreaterThanOrEqual(Math.ceil(verdicts.length * 0.6));
      expect(verdicts.filter((verdict) => verdict !== "unverifiable").length).toBeGreaterThanOrEqual(1);
    },
  );
});
