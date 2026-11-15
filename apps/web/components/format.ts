import { qualityLabel } from "@/lib/clef/client";
import type { ClaimStatus, SourceTier, Stance, Verdict } from "@/lib/types";

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Evidence quality is a 0-4 level, not a probability. Rendering it with `pct`
 * showed "130%" in the drawer.
 */
export function quality(score: number): string {
  const clamped = Math.min(4, Math.max(0, score));
  return `${qualityLabel(clamped)} (${clamped.toFixed(1)} de 4)`;
}

export const CLAIM_STATUS_TEXT: Record<ClaimStatus, string> = {
  detected: "En cola",
  searching: "Buscando evidencia",
  evaluating: "Evaluando con Clef",
  resolved: "Resuelta",
  failed: "Falló",
};

export const TIER_TEXT: Record<SourceTier, string> = {
  primary: "Primaria",
  reliable_secondary: "Secundaria",
  other: "Otra",
};

export const STANCE_TEXT: Record<Stance, string> = {
  supports: "A favor",
  contradicts: "En contra",
  context: "Contexto",
};

export const VERDICT_TEXT: Record<Verdict, string> = {
  supported: "Respaldada",
  contradicted: "Contradicha",
  misleading: "Engañosa",
  unverifiable: "No verificable",
};
