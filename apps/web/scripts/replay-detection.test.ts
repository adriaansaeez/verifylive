/**
 * Detection regression harness.
 *
 * Replays a real captured transcript through the claim window and the live
 * Clef gate and prints every claim it would publish. This is how the gate
 * thresholds were calibrated: the fixture is the actual Parakeet output from a
 * tab capture, duplicated tails and ASR garble included.
 *
 *   VERIFYLIVE_REPLAY=1 npx vitest run scripts/replay-detection.test.ts
 *
 * It calls the real NaN endpoint, so it is skipped unless VERIFYLIVE_REPLAY is
 * set. Expected claims are asserted loosely: the point is to catch a drop in
 * recall, not to freeze one exact wording.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaimWindow, type ClaimCandidate } from "@/lib/claims/claim-window";
import { runGate } from "@/lib/claims/gate";
import { transcriptDelta } from "@/lib/client/transcript-merge";
import { normalizeText, rewriteNumberWords, splitSentences } from "@/lib/text";

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

type Fixture = {
  segments: { seq: number; startMs: number; endMs: number; text: string }[];
};

/** Facts stated in the captured interview that a fact-checker must pick up. */
const EXPECTED = [
  ["inversión multiplicada por veinte", ["multiplicado", "veinte"]],
  ["19.000 millones en mantenimiento", ["19000", "millones"]],
  ["quince años para revertir los recortes", ["15", "revertir"]],
  ["sistema ferroviario seguro", ["sistema", "seguro"]],
  ["averías y retrasos habituales", ["averias", "habitual"]],
  ["AVE Madrid Ourense y Madrid Murcia", ["ave", "ourense"]],
] as const;

const enabled = process.env.VERIFYLIVE_REPLAY === "1" && Boolean(process.env.NAN_KEY?.trim());

type Segment = { seq: number; startMs: number; endMs: number; text: string };

type Published = { atMs: number; text: string; closed: number; factual: number };

type Run = {
  published: Published[];
  gateCalls: number;
  spansConsidered: number;
};

async function replay(segments: Segment[]): Promise<Run> {
  const window = new ClaimWindow();
  const published: Published[] = [];
  let gateCalls = 0;
  let spansConsidered = 0;

  for (const segment of segments) {
    let candidates: ClaimCandidate[] = [];
    for (const utterance of splitSentences(segment.text)) {
      candidates = window.append({
        text: utterance,
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    }
    const result = await runGate(candidates);
    if (!result.skipped) gateCalls += 1;
    spansConsidered += result.scores.length;
    if (result.selected) {
      published.push({
        atMs: result.selected.candidate.startMs,
        text: result.selected.candidate.text,
        closed: result.selected.closed,
        factual: result.selected.factual,
      });
      window.consume(result.selected.candidate);
    }
  }

  return { published, gateCalls, spansConsidered };
}

/**
 * The fixture was captured while the old exact-match reconciliation was live,
 * so seven segments still begin by repeating their predecessor's tail. Running
 * them back through the current merge reproduces the transcript the app would
 * produce today, which is the input the gate actually has to judge.
 */
function deduplicate(segments: Segment[]): Segment[] {
  const output: Segment[] = [];
  let previous = "";
  for (const segment of segments) {
    const text = transcriptDelta(previous, segment.text);
    previous = segment.text;
    if (text.length < 3) continue;
    output.push({ ...segment, text });
  }
  return output;
}

function describeRun(label: string, run: Run, segments: number): string {
  const haystack = run.published.map((claim) => normalizeText(rewriteNumberWords(claim.text)));
  const found = EXPECTED.filter(([, tokens]) =>
    haystack.some((text) => tokens.every((token) => text.includes(token))),
  ).map(([claimLabel]) => claimLabel);
  const missing = EXPECTED.filter(([claimLabel]) => !found.includes(claimLabel)).map(
    ([claimLabel]) => claimLabel,
  );
  const lines = run.published.map(
    (claim, index) =>
      `${String(index + 1).padStart(2, " ")}. [${(claim.atMs / 1000).toFixed(0)}s cl=${claim.closed.toFixed(2)} fa=${claim.factual.toFixed(2)}] ${claim.text}`,
  );
  return [
    "",
    `=== ${label} ===`,
    `segmentos: ${segments}   llamadas al gate: ${run.gateCalls}   spans juzgados: ${run.spansConsidered}`,
    `claims publicados: ${run.published.length}   esperados: ${found.length}/${EXPECTED.length}`,
    `no hallados: ${missing.length > 0 ? missing.join(", ") : "ninguno"}`,
    "",
    ...lines,
  ].join("\n");
}

function hits(run: Run): string[] {
  const haystack = run.published.map((claim) => normalizeText(rewriteNumberWords(claim.text)));
  return EXPECTED.filter(([, tokens]) =>
    haystack.some((text) => tokens.every((token) => text.includes(token))),
  ).map(([label]) => label);
}

describe.skipIf(!enabled)("detection replay", () => {
  it(
    "finds the checkable claims in a real tab capture",
    { timeout: 15 * 60_000 },
    async () => {
      const fixture = JSON.parse(
        readFileSync(resolve(process.cwd(), "fixtures/transcripts/youtube-rail.json"), "utf8"),
      ) as { segments: Segment[] };

      const asCaptured = await replay(fixture.segments);
      const merged = deduplicate(fixture.segments);
      const asMergedToday = await replay(merged);

      console.log(
        [
          describeRun("tal y como se capturó", asCaptured, fixture.segments.length),
          describeRun("con la reconciliación actual", asMergedToday, merged.length),
          "",
        ].join("\n"),
      );

      // The old single-question gate published 3 claims from these 56 segments,
      // one of them truncated mid-sentence.
      expect(asMergedToday.published.length).toBeGreaterThanOrEqual(10);
      expect(hits(asMergedToday).length).toBeGreaterThanOrEqual(5);
      // The truncation this harness exists to prevent.
      const texts = asMergedToday.published.map((claim) => normalizeText(claim.text));
      expect(texts.some((text) => text.endsWith("el ave madrid"))).toBe(false);
    },
  );
});
