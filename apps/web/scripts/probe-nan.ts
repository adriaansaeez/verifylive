/**
 * NaN / Clef diagnostic probe.
 *
 * Usage:
 *   NAN_KEY=... NAN_BASE_URL=https://api.nan.builders npm run probe:nan
 *
 * Reads `.env.local` and `.env` (plain key=value lines) without overriding
 * variables that are already exported. Prints one HTTP round trip, the parsed
 * model output and PASS/FAIL checks. Exits 1 on HTTP or parse failure (or when
 * an expectation fails); without NAN_KEY it prints a friendly message and
 * exits 0 so it is safe to run in a fresh clone.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type VerdictKey = "supported" | "contradicted" | "misleading" | "unverifiable";

type ClefAnswers = {
  verdict?: {
    choice?: string;
    confidence?: number;
    probabilities?: Record<string, number>;
  };
  is_checkable?: unknown;
  evidence_quality?: unknown;
  needs_more_sources?: unknown;
};

const VERDICT_KEYS: VerdictKey[] = ["supported", "contradicted", "misleading", "unverifiable"];

const STATE = JSON.stringify({
  instruction:
    "Evalúa la afirmación usando SOLO la evidencia adjunta. Si la evidencia no alcanza, dilo. No uses conocimiento externo.",
  claim: "Madrid es la capital de España.",
  evidence: [
    {
      title: "Madrid, capital de España",
      publisher: "Ayuntamiento de Madrid",
      excerpt: "Madrid es la capital de España.",
      source_tier: "primary",
    },
  ],
});

const QUESTIONS = {
  verdict: {
    type: "choice",
    instructions:
      "What verdict is justified only by the supplied evidence? Choose one option; never rely on outside knowledge.",
    criteria: {
      supported: "Reliable evidence directly supports the factual claim",
      contradicted: "Reliable evidence directly contradicts the factual claim",
      misleading: "A true fragment of the claim omits context that materially changes its meaning",
      unverifiable:
        "Evidence is insufficient, irrelevant or conflicting, or the statement is not a factual claim",
    },
  },
  is_checkable: {
    type: "noul",
    instructions:
      "Is this a concrete factual claim rather than an opinion, prediction, joke or value judgment?",
  },
  evidence_quality: {
    type: "score",
    instructions: "How strong and directly relevant is the supplied evidence?",
    criteria: [
      "None: no usable evidence",
      "Weak: tangential or undated sources",
      "Mixed: some support and some contradiction",
      "Strong: recent, relevant and consistent sources",
      "Primary and conclusive: official or first-hand record",
    ],
  },
  needs_more_sources: {
    type: "noul",
    instructions: "Would responsible verification require more or better sources?",
  },
};

function loadEnvFile(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim().replace(/^export\s+/, "");
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadEnv(): void {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nestedNumber(value: unknown, key: string): number | null {
  const direct = finiteNumber(value);
  if (direct !== null) return direct;
  const object = record(value);
  return object ? finiteNumber(object[key]) : null;
}

function probabilityMap(value: unknown): Record<string, number> {
  const object = record(value);
  const output: Record<string, number> = {};
  if (!object) return output;
  for (const [key, entry] of Object.entries(object)) {
    const numeric = finiteNumber(entry);
    if (numeric !== null) output[key] = numeric;
  }
  return output;
}

function extractAnswers(payload: unknown): ClefAnswers | null {
  const root = record(payload);
  if (!root) return null;
  const answers = record(root.answers);
  return answers && record(answers.verdict) ? (answers as ClefAnswers) : null;
}

function checkExpectations(input: {
  verdictProbs: Record<string, number>;
  verdictConfidence: number | null;
  checkable: number | null;
  quality: number | null;
  needsMore: number | null;
}): boolean {
  const failures: string[] = [];
  const report = (name: string, ok: boolean, detail: string): void => {
    if (!ok) failures.push(name);
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name} (${detail})`);
  };

  const probSum = VERDICT_KEYS.reduce((total, key) => total + (input.verdictProbs[key] ?? 0), 0);
  report("sum(verdictProbabilities) ≈ 1", Math.abs(probSum - 1) <= 0.02, probSum.toFixed(3));
  report(
    "verdictConfidence ∈ [0,1]",
    input.verdictConfidence !== null &&
      input.verdictConfidence >= 0 &&
      input.verdictConfidence <= 1,
    input.verdictConfidence === null ? "missing" : input.verdictConfidence.toFixed(3),
  );
  report(
    "is_checkable ∈ [0,1]",
    input.checkable !== null && input.checkable >= 0 && input.checkable <= 1,
    input.checkable === null ? "missing" : input.checkable.toFixed(3),
  );
  report(
    "evidence_quality ∈ [0,4]",
    input.quality !== null && input.quality >= 0 && input.quality <= 4,
    input.quality === null ? "missing" : input.quality.toFixed(2),
  );
  report(
    "needs_more_sources ∈ [0,1]",
    input.needsMore !== null && input.needsMore >= 0 && input.needsMore <= 1,
    input.needsMore === null ? "missing" : input.needsMore.toFixed(3),
  );

  return failures.length === 0;
}

async function main(): Promise<number> {
  loadEnv();

  const key = process.env.NAN_KEY?.trim();
  if (!key) {
    console.log("NAN_KEY is not configured.");
    console.log("Add NAN_KEY=... to .env.local (or export it) to probe the live API.");
    console.log("Without a key the app still runs, but every verdict is labelled simulated.");
    return 0;
  }

  const baseUrl = (process.env.NAN_BASE_URL?.trim() || "https://api.nan.builders").replace(
    /\/+$/,
    "",
  );
  const endpoint = `${baseUrl}/v1/systemone`;

  console.log(`POST ${endpoint}`);
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "clef",
        state: STATE,
        questions: QUESTIONS,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const latency = Math.round(performance.now() - started);

  const bodyText = await response.text().catch(() => "");
  console.log(`HTTP status: ${response.status}`);
  console.log(`Latency: ${latency} ms`);
  if (!response.ok) {
    const hint = response.status === 429 || response.status === 502 || response.status === 504
      ? " (retryable upstream error)"
      : "";
    console.error(`Clef request failed${hint}: ${bodyText.slice(0, 300)}`);
    return 1;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    console.error(`Response was not JSON: ${bodyText.slice(0, 300)}`);
    return 1;
  }

  const root = record(payload) ?? {};
  const model = typeof root.model === "string" ? root.model : "(not reported)";
  const usage = record(root.usage);
  const inputTokens = finiteNumber(usage?.input_tokens);
  const outputTokens = finiteNumber(usage?.output_tokens);
  console.log(`Model: ${model}`);
  console.log(
    `Usage: input=${inputTokens ?? "?"} output=${outputTokens ?? "?"} tokens`,
  );

  const answers = extractAnswers(payload);
  if (!answers) {
    console.error("Could not parse Clef answers from the /v1/systemone response.");
    return 1;
  }

  const verdict = record(answers.verdict);
  const verdictProbs = probabilityMap(verdict?.probabilities);
  const verdictConfidence = finiteNumber(verdict?.confidence);
  const checkable = nestedNumber(answers.is_checkable, "noul");
  const quality = nestedNumber(answers.evidence_quality, "score");
  const needsMore = nestedNumber(answers.needs_more_sources, "noul");

  console.log("Parsed probabilities:");
  for (const key_ of VERDICT_KEYS) {
    console.log(`  ${key_}: ${(verdictProbs[key_] ?? 0).toFixed(4)}`);
  }
  console.log(`  verdictConfidence: ${verdictConfidence ?? "missing"}`);
  console.log(`  checkable: ${checkable ?? "missing"}`);
  console.log(`  evidenceQuality: ${quality ?? "missing"}`);
  console.log(`  needsMoreSources: ${needsMore ?? "missing"}`);

  console.log("Expectations:");
  const passed = checkExpectations({
    verdictProbs,
    verdictConfidence,
    checkable,
    quality,
    needsMore,
  });
  return passed ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
