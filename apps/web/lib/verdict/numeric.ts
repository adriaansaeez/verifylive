import type { Checkability, Stance, Verdict } from "@/lib/types";
import { rewriteNumberWords } from "@/lib/text";

export type NumericComparison = "consistent" | "conflict" | "ambiguous" | "none";

const NUMERIC_TOKEN = /\d[\d.,]*(?:\s\d{3}\b)*/gu;

type NumericFact = { value: number; unit: string | null };

function digitsOf(token: string): number {
  return (token.match(/\d/gu) ?? []).length;
}

/**
 * Resolves a Spanish/US numeric token to a number. Both "40.075" (thousands
 * dot) and "8.848,86" (thousands dot + decimal comma) are supported, plus
 * English "1,234.56" and plain integers.
 */
function toNumber(raw: string): number | null {
  let token = raw.replace(/\s+/gu, "").replace(/[.,]+$/u, "");
  if (!token) return null;

  const hasDot = token.includes(".");
  const hasComma = token.includes(",");

  if (hasDot && hasComma) {
    const lastDot = token.lastIndexOf(".");
    const lastComma = token.lastIndexOf(",");
    token =
      lastComma > lastDot
        ? token.replace(/\./gu, "").replace(",", ".")
        : token.replace(/,/gu, "");
  } else if (hasComma) {
    const parts = token.split(",");
    if (parts.length > 2) {
      token = parts.join("");
    } else {
      const [intPart = "", frac = ""] = parts;
      token =
        frac.length === 3 && intPart.length > 0 && intPart.length <= 3 && !intPart.startsWith("0")
          ? `${intPart}${frac}`
          : `${intPart}.${frac}`;
    }
  } else if (hasDot) {
    const parts = token.split(".");
    if (parts.length > 2) {
      token = parts.join("");
    } else {
      const [intPart = "", frac = ""] = parts;
      token =
        frac.length === 3 && intPart.length > 0 && intPart.length <= 3 && !intPart.startsWith("0")
          ? `${intPart}${frac}`
          : `${intPart}.${frac}`;
    }
  }

  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extracts comparable numbers from claim/evidence text. Spelled-out Spanish
 * quantities are rewritten to digits first, so "cuatrocientos mil" and
 * "400.000" compare equal.
 */
export function parseNumbers(text: string): number[] {
  const rewritten = rewriteNumberWords(text);
  const matches = rewritten.match(NUMERIC_TOKEN) ?? [];
  const numbers: number[] = [];
  for (const match of matches) {
    if (digitsOf(match) < 2) continue;
    const value = toNumber(match);
    if (value !== null) numbers.push(value);
  }
  return numbers;
}

function unitAfter(text: string, end: number, value: number): string | null {
  if (Number.isInteger(value) && value >= 1900 && value <= 2100) return "year";
  const suffix = text.slice(end, end + 32).toLowerCase();
  if (/^\s*(?:%|por\s+ciento\b)/u.test(suffix)) return "percent";
  if (/^\s*(?:km|kil[oó]metros?)\b/u.test(suffix)) return "kilometres";
  if (/^\s*(?:m|metros?)\b/u.test(suffix)) return "metres";
  if (/^\s*(?:kg|kilogramos?)\b/u.test(suffix)) return "kilograms";
  if (/^\s*(?:€|euros?|usd|d[oó]lares?)\b/u.test(suffix)) return "currency";
  return null;
}

function parseNumericFacts(text: string): NumericFact[] {
  const rewritten = rewriteNumberWords(text);
  const facts: NumericFact[] = [];
  for (const match of rewritten.matchAll(NUMERIC_TOKEN)) {
    const raw = match[0];
    if (!raw || digitsOf(raw) < 2) continue;
    const value = toNumber(raw);
    if (value === null) continue;
    const end = (match.index ?? 0) + raw.length;
    facts.push({ value, unit: unitAfter(rewritten, end, value) });
  }
  return facts;
}

function relativeDifference(left: number, right: number): number {
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale === 0 ? 0 : Math.abs(left - right) / scale;
}

function closestPair(
  claimNumbers: number[],
  evidenceNumbers: number[],
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const claimNumber of claimNumbers) {
    for (const evidenceNumber of evidenceNumbers) {
      const diff = relativeDifference(claimNumber, evidenceNumber);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = [claimNumber, evidenceNumber];
      }
    }
  }
  return best;
}

function comparisonDetails(
  claimFacts: NumericFact[],
  evidenceFacts: NumericFact[],
): { comparison: NumericComparison; pair: [number, number] | null } {
  const compared: { difference: number; pair: [number, number] }[] = [];
  for (const claimFact of claimFacts) {
    const compatible = evidenceFacts.filter((fact) => fact.unit === claimFact.unit);
    if (compatible.length === 0) continue;
    let closest = compatible[0];
    let bestDifference = Number.POSITIVE_INFINITY;
    for (const fact of compatible) {
      const difference = relativeDifference(claimFact.value, fact.value);
      if (difference < bestDifference) {
        bestDifference = difference;
        closest = fact;
      }
    }
    if (closest) compared.push({ difference: bestDifference, pair: [claimFact.value, closest.value] });
  }
  if (compared.length === 0) return { comparison: "none", pair: null };
  const worst = compared.reduce((left, right) =>
    right.difference > left.difference ? right : left,
  );
  if (compared.some((item) => item.difference >= 0.1)) {
    return { comparison: "conflict", pair: worst.pair };
  }
  if (compared.every((item) => item.difference <= 0.02)) {
    return { comparison: "consistent", pair: worst.pair };
  }
  return { comparison: "ambiguous", pair: worst.pair };
}

/**
 * Deterministic numeric sanity check. Rounding-level differences (<= 2%) are
 * consistent; differences of >= 10% conflict. Everything between is ambiguous.
 */
export function numericComparison(
  claimNumbers: number[],
  evidenceNumbers: number[],
): NumericComparison {
  if (claimNumbers.length === 0 || evidenceNumbers.length === 0) return "none";
  const comparisons: number[] = [];
  for (const claimNumber of claimNumbers) {
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const evidenceNumber of evidenceNumbers) {
      bestDiff = Math.min(bestDiff, relativeDifference(claimNumber, evidenceNumber));
    }
    comparisons.push(bestDiff);
  }
  // Every material figure in the claim must agree. A coincidental match (often
  // a year) must not hide a conflicting percentage or amount.
  if (comparisons.some((difference) => difference >= 0.1)) return "conflict";
  if (comparisons.every((difference) => difference <= 0.02)) return "consistent";
  return "ambiguous";
}

function formatNumber(value: number): string {
  return String(value);
}

function numericNote(pair: [number, number] | null): string {
  if (!pair) return " · verificación numérica: sin cifras comparables";
  return ` · verificación numérica: ${formatNumber(pair[0])} vs ${formatNumber(pair[1])}`;
}

export type NumericCheckInput = {
  verdict: Verdict;
  confidence: number;
  provisional: boolean;
  rationale: string;
  claimText: string;
  checkability: Checkability;
  evidence: { stance: Stance | null; excerpt: string; excerptNums?: number[]; sourceKey?: string }[];
  evidenceCount: number;
  distinctSourceCount?: number;
};

export type NumericCheckResult = {
  verdict: Verdict;
  confidence: number;
  provisional: boolean;
  rationale: string;
};

/**
 * Applies the numeric layer last: it can only override the chosen verdict,
 * confidence, provisional flag and rationale, and never widens the evidence
 * or claim types.
 */
export function applyNumericCheck(input: NumericCheckInput): NumericCheckResult {
  const { verdict, confidence, provisional, rationale, claimText, checkability } = input;
  const unchanged: NumericCheckResult = { verdict, confidence, provisional, rationale };

  if (checkability === "likely_opinion") return unchanged;
  if (input.evidenceCount < 2 || input.evidence.length === 0) return unchanged;
  // Numeric agreement is a consistency check, not corroboration. It may not
  // bypass the verdict policy's minimum of two independent publishers.
  if ((input.distinctSourceCount ?? 0) < 2) return unchanged;

  const claimNumbers = parseNumbers(claimText);
  if (claimNumbers.length === 0) return unchanged;

  const rows = input.evidence.map((item, index) => {
    const numbers = item.excerptNums ?? parseNumbers(item.excerpt);
    const details = item.excerptNums
      ? { comparison: numericComparison(claimNumbers, numbers), pair: closestPair(claimNumbers, numbers) }
      : comparisonDetails(parseNumericFacts(claimText), parseNumericFacts(item.excerpt));
    return {
      stance: item.stance ?? null,
      sourceKey: item.sourceKey ?? `evidence:${index}`,
      ...details,
    };
  });

  const conflictingContradictions = rows.filter(
    (row) => row.stance === "contradicts" && row.comparison === "conflict",
  );
  const conflictingContradiction = conflictingContradictions[0];

  if (
    conflictingContradiction &&
    (verdict === "supported" || verdict === "unverifiable" || verdict === "misleading")
  ) {
    return {
      verdict: "contradicted",
      confidence: Math.max(confidence, 0.82),
      provisional: provisional || new Set(conflictingContradictions.map((row) => row.sourceKey)).size < 2,
      rationale: `${rationale}${numericNote(conflictingContradiction.pair)}`,
    };
  }

  if (verdict === "contradicted") {
    const contradicting = rows.filter((row) => row.stance === "contradicts");
    const onlyRounding =
      contradicting.length > 0 && contradicting.every((row) => row.comparison === "consistent");
    const anyConflict = rows.some((row) => row.comparison === "conflict");
    if (onlyRounding && !anyConflict) {
      return {
        verdict: "supported",
        confidence: Math.max(confidence, 0.8),
        provisional: provisional || new Set(contradicting.map((row) => row.sourceKey)).size < 2,
        rationale: `${rationale}${numericNote(contradicting[0]?.pair ?? null)}`,
      };
    }
  }

  if (verdict === "unverifiable") {
    const supporting = rows.filter(
      (row) => row.stance === "supports" && row.comparison === "consistent",
    );
    const anyConflict = rows.some((row) => row.comparison === "conflict");
    if (supporting.length > 0 && !anyConflict) {
      return {
        verdict: "supported",
        confidence: Math.max(confidence, 0.8),
        provisional: provisional || new Set(supporting.map((row) => row.sourceKey)).size < 2,
        rationale: `${rationale}${numericNote(supporting[0]?.pair ?? null)}`,
      };
    }
  }

  return unchanged;
}
