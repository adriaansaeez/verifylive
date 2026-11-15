import corpusJson from "@/fixtures/evidence/corpus.json";
import demoJson from "@/fixtures/transcripts/demo.json";
import type {
  Checkability,
  SourceTier,
  Stance,
  Verdict,
} from "@/lib/types";

export type CorpusEvidence = {
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  sourceTier: SourceTier;
  stance: Stance | null;
  excerpt: string;
};

export type CorpusEntry = {
  id: string;
  claim: string;
  aliases: string[];
  keywords: string[];
  expectedVerdict: Verdict;
  rationale: string;
  evidence: CorpusEvidence[];
};

export type FixtureTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type FixtureTranscript = {
  id: string;
  title: string;
  language: string;
  durationMs: number;
  notes: string;
  segments: FixtureTranscriptSegment[];
};

type CorpusFile = {
  version: number;
  createdAt: string;
  notes: string;
  entries: CorpusEntry[];
};

const corpus = corpusJson as CorpusFile;

export function corpusEntries(): CorpusEntry[] {
  return corpus.entries;
}

export function findCorpusEntry(id: string): CorpusEntry | null {
  return corpus.entries.find((entry) => entry.id === id) ?? null;
}

export function demoTranscript(): FixtureTranscript {
  return demoJson as FixtureTranscript;
}

export function fixtureTranscript(id: string): FixtureTranscript | null {
  return demoTranscript().id === id ? demoTranscript() : null;
}

export const CHECKABILITY_LABELS: Record<Checkability, string> = {
  likely_fact: "Afirmación factual",
  likely_opinion: "Opinión o valoración",
  unclear: "Ambigua",
};
